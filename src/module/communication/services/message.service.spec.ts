import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException, ForbiddenException } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { Types } from 'mongoose';
import { MESSAGE_VISIBILITY, THREAD_STATUS } from '../../../common/constants/communication.constants';
import { CommunicationPermissions } from '../../../common/services/communication.permissions';
import { IAuthUser } from '../../../common/interfaces/auth-user.interface';
import { Role } from '../../auth/enum/role.enum';
import { Message } from '../schemas/message.schema';
import { ThreadReadState } from '../schemas/thread-read-state.schema';
import { MessageThreadService } from './message-thread.service';
import { MessageService } from './message.service';

describe('MessageService', () => {
  let service: MessageService;
  let mockMessageModel: { create: jest.Mock; find: jest.Mock; countDocuments: jest.Mock };
  let mockReadStateModel: { findOneAndUpdate: jest.Mock; findOne: jest.Mock };
  let mockThreadService: {
    getThreadDetailsForUser: jest.Mock;
    updateThreadLastMessage: jest.Mock;
    findThreadById: jest.Mock;
    getThreadDetails: jest.Mock;
  };
  let mockCommunicationPermissions: { assertCanReplyToThread: jest.Mock };

  const ulbUser: IAuthUser = {
    _id: new Types.ObjectId().toString(),
    role: Role.ULB,
    ulb: new Types.ObjectId().toString(),
  };
  const stateUser: IAuthUser = {
    _id: new Types.ObjectId().toString(),
    role: Role.STATE,
    state: new Types.ObjectId().toString(),
  };
  const adminUser: IAuthUser = { _id: new Types.ObjectId().toString(), role: Role.ADMIN };
  const mohuaUser: IAuthUser = { _id: new Types.ObjectId().toString(), role: Role.MoHUA };

  const threadId = new Types.ObjectId().toString();

  beforeEach(async () => {
    mockMessageModel = { create: jest.fn(), find: jest.fn(), countDocuments: jest.fn() };
    mockReadStateModel = { findOneAndUpdate: jest.fn(), findOne: jest.fn() };
    mockThreadService = {
      getThreadDetailsForUser: jest.fn(),
      updateThreadLastMessage: jest.fn().mockResolvedValue(undefined),
      findThreadById: jest.fn(),
      getThreadDetails: jest.fn(),
    };
    mockCommunicationPermissions = { assertCanReplyToThread: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MessageService,
        { provide: getModelToken(Message.name), useValue: mockMessageModel },
        { provide: getModelToken(ThreadReadState.name), useValue: mockReadStateModel },
        { provide: MessageThreadService, useValue: mockThreadService },
        { provide: CommunicationPermissions, useValue: mockCommunicationPermissions },
      ],
    }).compile();

    service = module.get<MessageService>(MessageService);
  });

  afterEach(() => jest.clearAllMocks());

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  // ─── sendMessageToThread ─────────────────────────────────────────────────

  describe('sendMessageToThread()', () => {
    const thread = { _id: threadId, contextType: 'FORM_SUBMISSION', contextId: new Types.ObjectId(), status: THREAD_STATUS.OPEN };
    const participants: any[] = [];

    it('creates the message after verifying reply permission for a non-system message', async () => {
      mockThreadService.getThreadDetailsForUser.mockResolvedValue({ thread, participants });
      const createdMessage = { _id: new Types.ObjectId(), body: 'hello' };
      mockMessageModel.create.mockResolvedValue([createdMessage]);

      const result = await service.sendMessageToThread({
        threadId,
        senderUser: ulbUser,
        body: 'hello',
      });

      expect(mockCommunicationPermissions.assertCanReplyToThread).toHaveBeenCalledWith(ulbUser, thread, participants);
      expect(mockMessageModel.create).toHaveBeenCalledWith(
        [expect.objectContaining({ body: 'hello', visibility: MESSAGE_VISIBILITY.EXTERNAL })],
        {},
      );
      expect(mockThreadService.updateThreadLastMessage).toHaveBeenCalledWith(threadId, 'hello', undefined);
      expect(result).toEqual(createdMessage);
    });

    it('skips the reply permission check for system-generated messages', async () => {
      mockThreadService.getThreadDetailsForUser.mockResolvedValue({ thread, participants });
      mockMessageModel.create.mockResolvedValue([{ _id: new Types.ObjectId() }]);

      await service.sendMessageToThread({
        threadId,
        senderUser: ulbUser,
        body: 'system note',
        isSystemGenerated: true,
      });

      expect(mockCommunicationPermissions.assertCanReplyToThread).not.toHaveBeenCalled();
    });

    it('propagates ForbiddenException when the user cannot reply', async () => {
      mockThreadService.getThreadDetailsForUser.mockResolvedValue({ thread, participants });
      mockCommunicationPermissions.assertCanReplyToThread.mockImplementation(() => {
        throw new ForbiddenException('You do not have permission to reply to this thread');
      });

      await expect(service.sendMessageToThread({ threadId, senderUser: ulbUser, body: 'hello' })).rejects.toThrow(
        ForbiddenException,
      );
      expect(mockMessageModel.create).not.toHaveBeenCalled();
    });

    it('resolves senderOrgId from user.ulb when present', async () => {
      mockThreadService.getThreadDetailsForUser.mockResolvedValue({ thread, participants });
      mockMessageModel.create.mockResolvedValue([{ _id: new Types.ObjectId() }]);

      await service.sendMessageToThread({ threadId, senderUser: ulbUser, body: 'hi' });

      const messageDoc = mockMessageModel.create.mock.calls[0][0][0];
      expect(messageDoc.senderOrgId?.toString()).toBe(ulbUser.ulb);
    });

    it('resolves senderOrgId from user.state when ulb is absent', async () => {
      mockThreadService.getThreadDetailsForUser.mockResolvedValue({ thread, participants });
      mockMessageModel.create.mockResolvedValue([{ _id: new Types.ObjectId() }]);

      await service.sendMessageToThread({ threadId, senderUser: stateUser, body: 'hi' });

      const messageDoc = mockMessageModel.create.mock.calls[0][0][0];
      expect(messageDoc.senderOrgId?.toString()).toBe(stateUser.state);
    });

    it('leaves senderOrgId undefined for a user with neither ulb nor state', async () => {
      mockThreadService.getThreadDetailsForUser.mockResolvedValue({ thread, participants });
      mockMessageModel.create.mockResolvedValue([{ _id: new Types.ObjectId() }]);

      await service.sendMessageToThread({ threadId, senderUser: adminUser, body: 'hi' });

      const messageDoc = mockMessageModel.create.mock.calls[0][0][0];
      expect(messageDoc.senderOrgId).toBeUndefined();
    });

    it('defaults visibility to EXTERNAL when not provided', async () => {
      mockThreadService.getThreadDetailsForUser.mockResolvedValue({ thread, participants });
      mockMessageModel.create.mockResolvedValue([{ _id: new Types.ObjectId() }]);

      await service.sendMessageToThread({ threadId, senderUser: ulbUser, body: 'hi' });

      const messageDoc = mockMessageModel.create.mock.calls[0][0][0];
      expect(messageDoc.visibility).toBe(MESSAGE_VISIBILITY.EXTERNAL);
    });

    it('uses the provided visibility when set', async () => {
      mockThreadService.getThreadDetailsForUser.mockResolvedValue({ thread, participants });
      mockMessageModel.create.mockResolvedValue([{ _id: new Types.ObjectId() }]);

      await service.sendMessageToThread({
        threadId,
        senderUser: ulbUser,
        body: 'hi',
        visibility: MESSAGE_VISIBILITY.INTERNAL_ULB,
      });

      const messageDoc = mockMessageModel.create.mock.calls[0][0][0];
      expect(messageDoc.visibility).toBe(MESSAGE_VISIBILITY.INTERNAL_ULB);
    });

    it('converts a provided parentMessageId to ObjectId', async () => {
      mockThreadService.getThreadDetailsForUser.mockResolvedValue({ thread, participants });
      mockMessageModel.create.mockResolvedValue([{ _id: new Types.ObjectId() }]);
      const parentId = new Types.ObjectId().toString();

      await service.sendMessageToThread({ threadId, senderUser: ulbUser, body: 'hi', parentMessageId: parentId });

      const messageDoc = mockMessageModel.create.mock.calls[0][0][0];
      expect(messageDoc.parentMessageId?.toString()).toBe(parentId);
    });
  });

  // ─── sendWorkflowMessage ─────────────────────────────────────────────────

  describe('sendWorkflowMessage()', () => {
    it('throws NotFoundException when the thread does not exist', async () => {
      mockThreadService.findThreadById.mockResolvedValue(null);

      await expect(
        service.sendWorkflowMessage({ threadId, senderUser: adminUser, body: 'workflow event' }),
      ).rejects.toThrow(NotFoundException);
      expect(mockMessageModel.create).not.toHaveBeenCalled();
    });

    it('creates the message without checking CommunicationPermissions', async () => {
      const thread = { _id: threadId, contextType: 'FORM_SUBMISSION', contextId: new Types.ObjectId() };
      mockThreadService.findThreadById.mockResolvedValue(thread);
      const createdMessage = { _id: new Types.ObjectId(), body: 'workflow event' };
      mockMessageModel.create.mockResolvedValue([createdMessage]);

      const result = await service.sendWorkflowMessage({ threadId, senderUser: adminUser, body: 'workflow event' });

      expect(mockCommunicationPermissions.assertCanReplyToThread).not.toHaveBeenCalled();
      expect(mockThreadService.updateThreadLastMessage).toHaveBeenCalledWith(threadId, 'workflow event', undefined);
      expect(result).toEqual(createdMessage);
    });
  });

  // ─── getThreadMessages ───────────────────────────────────────────────────

  describe('getThreadMessages()', () => {
    function mockFindMessages(records: unknown[], total: number) {
      mockMessageModel.find.mockReturnValue({
        sort: () => ({
          skip: () => ({
            limit: () => ({ lean: () => ({ exec: jest.fn().mockResolvedValue(records) }) }),
          }),
        }),
      });
      mockMessageModel.countDocuments.mockReturnValue({ exec: jest.fn().mockResolvedValue(total) });
    }

    it('verifies thread view access before returning messages', async () => {
      mockThreadService.getThreadDetails.mockResolvedValue({ _id: threadId });
      mockFindMessages([], 0);

      await service.getThreadMessages({ threadId, user: ulbUser, page: 1, limit: 20 });

      expect(mockThreadService.getThreadDetails).toHaveBeenCalledWith(threadId, ulbUser);
    });

    it('propagates ForbiddenException from thread access check', async () => {
      mockThreadService.getThreadDetails.mockRejectedValue(new ForbiddenException('no access'));

      await expect(service.getThreadMessages({ threadId, user: ulbUser, page: 1, limit: 20 })).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('restricts visibility filter for a ULB user', async () => {
      mockThreadService.getThreadDetails.mockResolvedValue({ _id: threadId });
      mockFindMessages([], 0);

      await service.getThreadMessages({ threadId, user: ulbUser, page: 1, limit: 20 });

      const filter = mockMessageModel.find.mock.calls[0][0];
      expect(filter.visibility.$in).toEqual([
        MESSAGE_VISIBILITY.EXTERNAL,
        MESSAGE_VISIBILITY.SYSTEM,
        MESSAGE_VISIBILITY.INTERNAL_ULB,
      ]);
    });

    it('restricts visibility filter for a STATE user', async () => {
      mockThreadService.getThreadDetails.mockResolvedValue({ _id: threadId });
      mockFindMessages([], 0);

      await service.getThreadMessages({ threadId, user: stateUser, page: 1, limit: 20 });

      const filter = mockMessageModel.find.mock.calls[0][0];
      expect(filter.visibility.$in).toEqual([
        MESSAGE_VISIBILITY.EXTERNAL,
        MESSAGE_VISIBILITY.SYSTEM,
        MESSAGE_VISIBILITY.INTERNAL_STATE,
      ]);
    });

    it('grants all internal visibilities for MoHUA and ADMIN users', async () => {
      mockThreadService.getThreadDetails.mockResolvedValue({ _id: threadId });
      mockFindMessages([], 0);

      await service.getThreadMessages({ threadId, user: mohuaUser, page: 1, limit: 20 });

      const filter = mockMessageModel.find.mock.calls[0][0];
      expect(filter.visibility.$in).toEqual(
        expect.arrayContaining([
          MESSAGE_VISIBILITY.INTERNAL_MOHUA,
          MESSAGE_VISIBILITY.INTERNAL_STATE,
          MESSAGE_VISIBILITY.INTERNAL_ULB,
        ]),
      );
    });

    it('returns paginated messages, total, page, and limit', async () => {
      mockThreadService.getThreadDetails.mockResolvedValue({ _id: threadId });
      const messages = [{ _id: new Types.ObjectId() }];
      mockFindMessages(messages, 1);

      const result = await service.getThreadMessages({ threadId, user: ulbUser, page: 2, limit: 10 });

      expect(result).toEqual({ messages, total: 1, page: 2, limit: 10 });
    });
  });

  // ─── markThreadAsRead ────────────────────────────────────────────────────

  describe('markThreadAsRead()', () => {
    it('upserts the read state with unreadCount reset to zero', async () => {
      const exec = jest.fn().mockResolvedValue({});
      mockReadStateModel.findOneAndUpdate.mockReturnValue({ exec });

      await service.markThreadAsRead(threadId, ulbUser);

      const [filter, update, options] = mockReadStateModel.findOneAndUpdate.mock.calls[0];
      expect(filter.threadId.toString()).toBe(threadId);
      expect(filter.userId.toString()).toBe(ulbUser._id);
      expect(update.unreadCount).toBe(0);
      expect(update.lastReadAt).toBeInstanceOf(Date);
      expect(options.upsert).toBe(true);
    });
  });

  // ─── getUnreadCount ──────────────────────────────────────────────────────

  describe('getUnreadCount()', () => {
    it('returns unreadCount from an existing read-state record', async () => {
      mockReadStateModel.findOne.mockReturnValue({
        lean: () => ({ exec: jest.fn().mockResolvedValue({ unreadCount: 5 }) }),
      });

      const result = await service.getUnreadCount(threadId, ulbUser);
      expect(result).toBe(5);
    });

    it('defaults to 0 when the read-state record has no unreadCount field', async () => {
      mockReadStateModel.findOne.mockReturnValue({
        lean: () => ({ exec: jest.fn().mockResolvedValue({}) }),
      });

      const result = await service.getUnreadCount(threadId, ulbUser);
      expect(result).toBe(0);
    });

    it('falls back to counting visible messages when no read-state record exists', async () => {
      mockReadStateModel.findOne.mockReturnValue({ lean: () => ({ exec: jest.fn().mockResolvedValue(null) }) });
      mockMessageModel.countDocuments.mockReturnValue({ exec: jest.fn().mockResolvedValue(7) });

      const result = await service.getUnreadCount(threadId, ulbUser);

      expect(result).toBe(7);
      const filter = mockMessageModel.countDocuments.mock.calls[0][0];
      expect(filter.visibility.$in).toContain(MESSAGE_VISIBILITY.INTERNAL_ULB);
    });
  });
});
