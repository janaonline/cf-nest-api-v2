import { Test, TestingModule } from '@nestjs/testing';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { Types } from 'mongoose';
import {
  CONTEXT_TYPE,
  THREAD_PERMISSION,
  THREAD_PURPOSE,
  THREAD_STATUS,
} from '../../../common/constants/communication.constants';
import { CommunicationPermissions } from '../../../common/services/communication.permissions';
import { IAuthUser } from '../../../common/interfaces/auth-user.interface';
import { IFormSubmission } from '../../../forms/interfaces/form-submission.interface';
import { Role } from '../../auth/enum/role.enum';
import { MessageThread } from '../schemas/message-thread.schema';
import { MessageThreadService } from './message-thread.service';
import { ThreadParticipantService } from './thread-participant.service';

describe('MessageThreadService', () => {
  let service: MessageThreadService;
  let mockThreadModel: {
    create: jest.Mock;
    findOne: jest.Mock;
    findByIdAndUpdate: jest.Mock;
    findOneAndUpdate: jest.Mock;
    findById: jest.Mock;
    find: jest.Mock;
    countDocuments: jest.Mock;
  };
  let mockParticipantService: { addRoleGroupParticipant: jest.Mock; getThreadParticipants: jest.Mock };
  let mockCommunicationPermissions: { assertCanViewThread: jest.Mock };

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

  beforeEach(async () => {
    mockThreadModel = {
      create: jest.fn(),
      findOne: jest.fn(),
      findByIdAndUpdate: jest.fn(),
      findOneAndUpdate: jest.fn(),
      findById: jest.fn(),
      find: jest.fn(),
      countDocuments: jest.fn(),
    };
    mockParticipantService = {
      addRoleGroupParticipant: jest.fn().mockResolvedValue(undefined),
      getThreadParticipants: jest.fn().mockResolvedValue([]),
    };
    mockCommunicationPermissions = {
      assertCanViewThread: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MessageThreadService,
        { provide: getModelToken(MessageThread.name), useValue: mockThreadModel },
        { provide: ThreadParticipantService, useValue: mockParticipantService },
        { provide: CommunicationPermissions, useValue: mockCommunicationPermissions },
      ],
    }).compile();

    service = module.get<MessageThreadService>(MessageThreadService);
  });

  afterEach(() => jest.clearAllMocks());

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  // ─── findOrCreateFormSubmissionThread ───────────────────────────────────

  describe('findOrCreateFormSubmissionThread()', () => {
    const formSubmission = {
      _id: new Types.ObjectId(),
      financialYear: '2025-26',
      formJsonId: new Types.ObjectId(),
      formName: 'Annual Accounts',
      ulbId: new Types.ObjectId(),
      stateId: new Types.ObjectId(),
      currentFormStatus: 1,
    } as unknown as IFormSubmission;

    it('returns the existing thread without creating a new one when found', async () => {
      const existingThread = { _id: new Types.ObjectId(), contextType: CONTEXT_TYPE.FORM_SUBMISSION };
      mockThreadModel.findOne.mockReturnValue({ lean: () => ({ exec: jest.fn().mockResolvedValue(existingThread) }) });

      const result = await service.findOrCreateFormSubmissionThread(formSubmission, ulbUser);

      expect(result).toEqual(existingThread);
      expect(mockThreadModel.create).not.toHaveBeenCalled();
    });

    it('creates a new thread and adds ULB + STATE participants when none exists', async () => {
      mockThreadModel.findOne.mockReturnValue({ lean: () => ({ exec: jest.fn().mockResolvedValue(null) }) });
      const createdThread = { _id: new Types.ObjectId(), contextType: CONTEXT_TYPE.FORM_SUBMISSION };
      mockThreadModel.create.mockResolvedValue([createdThread]);

      const result = await service.findOrCreateFormSubmissionThread(formSubmission, ulbUser);

      expect(result).toEqual(createdThread);
      expect(mockThreadModel.create).toHaveBeenCalledWith(
        [
          expect.objectContaining({
            contextType: CONTEXT_TYPE.FORM_SUBMISSION,
            threadPurpose: THREAD_PURPOSE.FORM_COMMUNICATION,
            status: THREAD_STATUS.OPEN,
          }),
        ],
        {},
      );
      expect(mockParticipantService.addRoleGroupParticipant).toHaveBeenCalledWith(
        createdThread._id.toString(),
        'ULB',
        formSubmission.ulbId,
        'ULB',
        [THREAD_PERMISSION.READ, THREAD_PERMISSION.REPLY],
        undefined,
      );
      expect(mockParticipantService.addRoleGroupParticipant).toHaveBeenCalledWith(
        createdThread._id.toString(),
        'STATE',
        formSubmission.stateId,
        'STATE',
        [THREAD_PERMISSION.READ, THREAD_PERMISSION.REPLY],
        undefined,
      );
      expect(mockParticipantService.addRoleGroupParticipant).toHaveBeenCalledTimes(2);
    });

    it('skips STATE participant creation when the form submission has no stateId', async () => {
      mockThreadModel.findOne.mockReturnValue({ lean: () => ({ exec: jest.fn().mockResolvedValue(null) }) });
      const createdThread = { _id: new Types.ObjectId() };
      mockThreadModel.create.mockResolvedValue([createdThread]);

      const submissionWithoutState = { ...formSubmission, stateId: undefined } as unknown as IFormSubmission;
      await service.findOrCreateFormSubmissionThread(submissionWithoutState, ulbUser);

      expect(mockParticipantService.addRoleGroupParticipant).toHaveBeenCalledTimes(1);
      expect(mockParticipantService.addRoleGroupParticipant).toHaveBeenCalledWith(
        expect.any(String),
        'ULB',
        expect.anything(),
        'ULB',
        expect.any(Array),
        undefined,
      );
    });

    it('passes the session through to create() and participant creation', async () => {
      mockThreadModel.findOne.mockReturnValue({ lean: () => ({ exec: jest.fn().mockResolvedValue(null) }) });
      const createdThread = { _id: new Types.ObjectId() };
      mockThreadModel.create.mockResolvedValue([createdThread]);
      const session = { id: 'fake-session' } as any;

      await service.findOrCreateFormSubmissionThread(formSubmission, ulbUser, session);

      expect(mockThreadModel.create).toHaveBeenCalledWith(expect.any(Array), { session });
      expect(mockParticipantService.addRoleGroupParticipant).toHaveBeenCalledWith(
        expect.any(String),
        'ULB',
        expect.anything(),
        'ULB',
        expect.any(Array),
        session,
      );
    });
  });

  // ─── getThreadByContext ──────────────────────────────────────────────────

  describe('getThreadByContext()', () => {
    it('returns the matching thread', async () => {
      const thread = { _id: new Types.ObjectId(), contextType: CONTEXT_TYPE.FORM_SUBMISSION };
      mockThreadModel.findOne.mockReturnValue({ lean: () => ({ exec: jest.fn().mockResolvedValue(thread) }) });

      const contextId = new Types.ObjectId().toString();
      const result = await service.getThreadByContext(
        CONTEXT_TYPE.FORM_SUBMISSION,
        contextId,
        THREAD_PURPOSE.FORM_COMMUNICATION,
      );

      expect(result).toEqual(thread);
      expect(mockThreadModel.findOne).toHaveBeenCalledWith({
        contextType: CONTEXT_TYPE.FORM_SUBMISSION,
        contextId: new Types.ObjectId(contextId),
        threadPurpose: THREAD_PURPOSE.FORM_COMMUNICATION,
      });
    });

    it('returns null when no thread matches', async () => {
      mockThreadModel.findOne.mockReturnValue({ lean: () => ({ exec: jest.fn().mockResolvedValue(null) }) });

      const result = await service.getThreadByContext(
        CONTEXT_TYPE.FORM_SUBMISSION,
        new Types.ObjectId().toString(),
        THREAD_PURPOSE.FORM_COMMUNICATION,
      );

      expect(result).toBeNull();
    });
  });

  // ─── updateThreadLastMessage ─────────────────────────────────────────────

  describe('updateThreadLastMessage()', () => {
    it('updates lastMessageAt and truncates the preview to 120 chars', async () => {
      const exec = jest.fn().mockResolvedValue({});
      mockThreadModel.findByIdAndUpdate.mockReturnValue({ exec });

      const threadId = new Types.ObjectId().toString();
      const longBody = 'x'.repeat(200);
      await service.updateThreadLastMessage(threadId, longBody);

      const [, update] = mockThreadModel.findByIdAndUpdate.mock.calls[0];
      expect(update.lastMessagePreview).toHaveLength(120);
      expect(update.lastMessageAt).toBeInstanceOf(Date);
    });

    it('does not truncate a short body', async () => {
      const exec = jest.fn().mockResolvedValue({});
      mockThreadModel.findByIdAndUpdate.mockReturnValue({ exec });

      await service.updateThreadLastMessage(new Types.ObjectId().toString(), 'short body');

      const [, update] = mockThreadModel.findByIdAndUpdate.mock.calls[0];
      expect(update.lastMessagePreview).toBe('short body');
    });
  });

  // ─── syncThreadFormStatus ────────────────────────────────────────────────

  describe('syncThreadFormStatus()', () => {
    it('updates currentFormStatus for the matching form thread', async () => {
      const exec = jest.fn().mockResolvedValue({});
      mockThreadModel.findOneAndUpdate.mockReturnValue({ exec });

      const formSubmission = {
        _id: new Types.ObjectId(),
        currentFormStatus: 3,
      } as unknown as IFormSubmission;

      await service.syncThreadFormStatus(formSubmission);

      expect(mockThreadModel.findOneAndUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          contextType: CONTEXT_TYPE.FORM_SUBMISSION,
          threadPurpose: THREAD_PURPOSE.FORM_COMMUNICATION,
        }),
        { currentFormStatus: 3 },
        {},
      );
    });
  });

  // ─── findThreadById ──────────────────────────────────────────────────────

  describe('findThreadById()', () => {
    it('returns the thread when found', async () => {
      const thread = { _id: new Types.ObjectId() };
      mockThreadModel.findById.mockReturnValue({
        session: () => ({ lean: () => ({ exec: jest.fn().mockResolvedValue(thread) }) }),
      });

      const result = await service.findThreadById(thread._id.toString());
      expect(result).toEqual(thread);
    });

    it('returns null when not found', async () => {
      mockThreadModel.findById.mockReturnValue({
        session: () => ({ lean: () => ({ exec: jest.fn().mockResolvedValue(null) }) }),
      });

      const result = await service.findThreadById(new Types.ObjectId().toString());
      expect(result).toBeNull();
    });
  });

  // ─── getThreadDetailsForUser ─────────────────────────────────────────────

  describe('getThreadDetailsForUser()', () => {
    it('throws NotFoundException when the thread does not exist', async () => {
      mockThreadModel.findById.mockReturnValue({
        session: () => ({ lean: () => ({ exec: jest.fn().mockResolvedValue(null) }) }),
      });

      await expect(service.getThreadDetailsForUser(new Types.ObjectId().toString(), ulbUser)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('throws ForbiddenException when permissions check fails', async () => {
      const thread = { _id: new Types.ObjectId(), status: THREAD_STATUS.OPEN };
      mockThreadModel.findById.mockReturnValue({
        session: () => ({ lean: () => ({ exec: jest.fn().mockResolvedValue(thread) }) }),
      });
      mockParticipantService.getThreadParticipants.mockResolvedValue([]);
      mockCommunicationPermissions.assertCanViewThread.mockImplementation(() => {
        throw new ForbiddenException('You do not have permission to view this thread');
      });

      await expect(service.getThreadDetailsForUser(thread._id.toString(), ulbUser)).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('returns the thread and participants when access is allowed', async () => {
      const thread = { _id: new Types.ObjectId(), status: THREAD_STATUS.OPEN };
      const participants = [{ _id: new Types.ObjectId(), participantType: 'USER' }];
      mockThreadModel.findById.mockReturnValue({
        session: () => ({ lean: () => ({ exec: jest.fn().mockResolvedValue(thread) }) }),
      });
      mockParticipantService.getThreadParticipants.mockResolvedValue(participants);

      const result = await service.getThreadDetailsForUser(thread._id.toString(), adminUser);

      expect(result.thread).toEqual(thread);
      expect(result.participants).toEqual(participants);
      expect(mockCommunicationPermissions.assertCanViewThread).toHaveBeenCalledWith(adminUser, thread, participants);
    });
  });

  // ─── getThreadDetails ────────────────────────────────────────────────────

  describe('getThreadDetails()', () => {
    it('delegates to getThreadDetailsForUser and returns only the thread', async () => {
      const thread = { _id: new Types.ObjectId(), status: THREAD_STATUS.OPEN };
      mockThreadModel.findById.mockReturnValue({
        session: () => ({ lean: () => ({ exec: jest.fn().mockResolvedValue(thread) }) }),
      });
      mockParticipantService.getThreadParticipants.mockResolvedValue([]);

      const result = await service.getThreadDetails(thread._id.toString(), adminUser);

      expect(result).toEqual(thread);
    });
  });

  // ─── getThreads ──────────────────────────────────────────────────────────

  describe('getThreads()', () => {
    function mockFindThreads(records: unknown[], total: number) {
      mockThreadModel.find.mockReturnValue({
        sort: () => ({
          skip: () => ({
            limit: () => ({ lean: () => ({ exec: jest.fn().mockResolvedValue(records) }) }),
          }),
        }),
      });
      mockThreadModel.countDocuments.mockReturnValue({ exec: jest.fn().mockResolvedValue(total) });
    }

    it('scopes the query to the ULB user own ulbId', async () => {
      mockFindThreads([], 0);

      await service.getThreads(ulbUser, { page: 1, limit: 20 });

      const findArg = mockThreadModel.find.mock.calls[0][0];
      expect(findArg.ulbId.toString()).toBe(ulbUser.ulb);
    });

    it('scopes the query to the STATE user own stateId', async () => {
      mockFindThreads([], 0);

      await service.getThreads(stateUser, { page: 1, limit: 20 });

      const findArg = mockThreadModel.find.mock.calls[0][0];
      expect(findArg.stateId.toString()).toBe(stateUser.state);
    });

    it('does not scope the query for ADMIN users', async () => {
      mockFindThreads([], 0);

      await service.getThreads(adminUser, { page: 1, limit: 20 });

      const findArg = mockThreadModel.find.mock.calls[0][0];
      expect(findArg.ulbId).toBeUndefined();
      expect(findArg.stateId).toBeUndefined();
    });

    it('applies search as a case-insensitive $or on formName and title', async () => {
      mockFindThreads([], 0);

      await service.getThreads(adminUser, { page: 1, limit: 20, search: 'Annual' });

      const findArg = mockThreadModel.find.mock.calls[0][0];
      expect(findArg.$or).toEqual([
        { formName: { $regex: 'Annual', $options: 'i' } },
        { title: { $regex: 'Annual', $options: 'i' } },
      ]);
    });

    it('applies optional filters (financialYear, contextType, threadPurpose, currentFormStatus)', async () => {
      mockFindThreads([], 0);

      await service.getThreads(adminUser, {
        page: 1,
        limit: 20,
        financialYear: '2025-26',
        contextType: CONTEXT_TYPE.FORM_SUBMISSION,
        threadPurpose: THREAD_PURPOSE.FORM_COMMUNICATION,
        currentFormStatus: 0,
      });

      const findArg = mockThreadModel.find.mock.calls[0][0];
      expect(findArg.financialYear).toBe('2025-26');
      expect(findArg.contextType).toBe(CONTEXT_TYPE.FORM_SUBMISSION);
      expect(findArg.threadPurpose).toBe(THREAD_PURPOSE.FORM_COMMUNICATION);
      // currentFormStatus 0 must still be applied (falsy-but-defined edge case)
      expect(findArg.currentFormStatus).toBe(0);
    });

    it('returns threads and total count', async () => {
      const threads = [{ _id: new Types.ObjectId() }, { _id: new Types.ObjectId() }];
      mockFindThreads(threads, 2);

      const result = await service.getThreads(adminUser, { page: 1, limit: 20 });

      expect(result.threads).toEqual(threads);
      expect(result.total).toBe(2);
    });
  });
});
