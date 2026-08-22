import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { Types } from 'mongoose';
import { CONTEXT_TYPE, THREAD_PURPOSE } from '../../common/constants/communication.constants';
import { IAuthUser } from '../../common/interfaces/auth-user.interface';
import { Role } from '../auth/enum/role.enum';
import { CommunicationController } from './communication.controller';
import { GetThreadsDto } from './dto/get-threads.dto';
import { SendMessageDto } from './dto/send-message.dto';
import { MessageThreadService } from './services/message-thread.service';
import { MessageService } from './services/message.service';

describe('CommunicationController', () => {
  let controller: CommunicationController;
  let mockThreadService: jest.Mocked<Pick<MessageThreadService, 'getThreads' | 'getThreadDetails' | 'getThreadByContext'>>;
  let mockMessageService: jest.Mocked<
    Pick<MessageService, 'getThreadMessages' | 'sendMessageToThread' | 'markThreadAsRead'>
  >;

  const user: IAuthUser = { _id: new Types.ObjectId().toString(), role: Role.ULB, ulb: new Types.ObjectId().toString() };
  const threadId = new Types.ObjectId().toString();
  const formSubmissionId = new Types.ObjectId().toString();

  beforeEach(async () => {
    mockThreadService = {
      getThreads: jest.fn(),
      getThreadDetails: jest.fn(),
      getThreadByContext: jest.fn(),
    } as any;
    mockMessageService = {
      getThreadMessages: jest.fn(),
      sendMessageToThread: jest.fn(),
      markThreadAsRead: jest.fn(),
    } as any;

    const module: TestingModule = await Test.createTestingModule({
      controllers: [CommunicationController],
      providers: [
        { provide: MessageThreadService, useValue: mockThreadService },
        { provide: MessageService, useValue: mockMessageService },
      ],
    }).compile();

    controller = module.get<CommunicationController>(CommunicationController);
  });

  afterEach(() => jest.clearAllMocks());

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  // ─── getThreads ──────────────────────────────────────────────────────────

  describe('getThreads()', () => {
    it('forwards query filters and defaults page/limit', async () => {
      const response = { threads: [], total: 0 };
      mockThreadService.getThreads.mockResolvedValue(response);

      const query: GetThreadsDto = { financialYear: '2025-26' };
      const result = await controller.getThreads(query, user);

      expect(mockThreadService.getThreads).toHaveBeenCalledWith(user, {
        financialYear: '2025-26',
        contextType: undefined,
        threadPurpose: undefined,
        currentFormStatus: undefined,
        search: undefined,
        page: 1,
        limit: 20,
      });
      expect(result).toEqual(response);
    });

    it('passes through explicit page and limit', async () => {
      mockThreadService.getThreads.mockResolvedValue({ threads: [], total: 0 });

      const query: GetThreadsDto = { page: 3, limit: 50 };
      await controller.getThreads(query, user);

      expect(mockThreadService.getThreads).toHaveBeenCalledWith(
        user,
        expect.objectContaining({ page: 3, limit: 50 }),
      );
    });
  });

  // ─── getThreadDetails ────────────────────────────────────────────────────

  describe('getThreadDetails()', () => {
    it('returns the thread from the service', async () => {
      const thread = { _id: threadId } as any;
      mockThreadService.getThreadDetails.mockResolvedValue(thread);

      const result = await controller.getThreadDetails(threadId, user);

      expect(mockThreadService.getThreadDetails).toHaveBeenCalledWith(threadId, user);
      expect(result).toEqual(thread);
    });

    it('propagates errors from the service', async () => {
      mockThreadService.getThreadDetails.mockRejectedValue(new NotFoundException('Thread not found'));

      await expect(controller.getThreadDetails(threadId, user)).rejects.toThrow(NotFoundException);
    });
  });

  // ─── getThreadMessages ───────────────────────────────────────────────────

  describe('getThreadMessages()', () => {
    it('parses page/limit query strings and caps limit at 100', async () => {
      const response = { messages: [], total: 0, page: 1, limit: 100 };
      mockMessageService.getThreadMessages.mockResolvedValue(response as any);

      const result = await controller.getThreadMessages(threadId, '1', '500', user);

      expect(mockMessageService.getThreadMessages).toHaveBeenCalledWith({
        threadId,
        user,
        page: 1,
        limit: 100,
      });
      expect(result).toEqual(response);
    });

    it('uses default page/limit string values', async () => {
      mockMessageService.getThreadMessages.mockResolvedValue({ messages: [], total: 0, page: 1, limit: 20 } as any);

      await controller.getThreadMessages(threadId, undefined as unknown as string, undefined as unknown as string, user);

      expect(mockMessageService.getThreadMessages).toHaveBeenCalledWith(
        expect.objectContaining({ threadId, user }),
      );
    });
  });

  // ─── sendMessageToThread ─────────────────────────────────────────────────

  describe('sendMessageToThread()', () => {
    it('forwards dto fields and current user to the service', async () => {
      const dto: SendMessageDto = { body: 'hello there' };
      const createdMessage = { _id: new Types.ObjectId(), body: 'hello there' } as any;
      mockMessageService.sendMessageToThread.mockResolvedValue(createdMessage);

      const result = await controller.sendMessageToThread(threadId, dto, user);

      expect(mockMessageService.sendMessageToThread).toHaveBeenCalledWith({
        threadId,
        senderUser: user,
        body: dto.body,
        attachments: undefined,
        visibility: undefined,
        parentMessageId: undefined,
      });
      expect(result).toEqual(createdMessage);
    });
  });

  // ─── markThreadAsRead ────────────────────────────────────────────────────

  describe('markThreadAsRead()', () => {
    it('delegates to messageService.markThreadAsRead', async () => {
      mockMessageService.markThreadAsRead.mockResolvedValue(undefined);

      await controller.markThreadAsRead(threadId, user);

      expect(mockMessageService.markThreadAsRead).toHaveBeenCalledWith(threadId, user);
    });
  });

  // ─── Form-submission scoped shortcuts ────────────────────────────────────

  describe('sendMessageToFormSubmission()', () => {
    it('resolves the thread by formSubmissionId then sends the message', async () => {
      const thread = { _id: new Types.ObjectId(threadId) } as any;
      mockThreadService.getThreadByContext.mockResolvedValue(thread);
      const createdMessage = { _id: new Types.ObjectId(), body: 'hi' } as any;
      mockMessageService.sendMessageToThread.mockResolvedValue(createdMessage);

      const dto: SendMessageDto = { body: 'hi' };
      const result = await controller.sendMessageToFormSubmission(formSubmissionId, dto, user);

      expect(mockThreadService.getThreadByContext).toHaveBeenCalledWith(
        CONTEXT_TYPE.FORM_SUBMISSION,
        formSubmissionId,
        THREAD_PURPOSE.FORM_COMMUNICATION,
      );
      expect(mockMessageService.sendMessageToThread).toHaveBeenCalledWith(
        expect.objectContaining({ threadId: thread._id.toString(), senderUser: user, body: 'hi' }),
      );
      expect(result).toEqual(createdMessage);
    });

    it('throws NotFoundException when no thread exists for the form submission', async () => {
      mockThreadService.getThreadByContext.mockResolvedValue(null);

      const dto: SendMessageDto = { body: 'hi' };
      await expect(controller.sendMessageToFormSubmission(formSubmissionId, dto, user)).rejects.toThrow(
        NotFoundException,
      );
      expect(mockMessageService.sendMessageToThread).not.toHaveBeenCalled();
    });
  });

  describe('getFormSubmissionMessages()', () => {
    it('resolves the thread then fetches paginated messages', async () => {
      const thread = { _id: new Types.ObjectId(threadId) } as any;
      mockThreadService.getThreadByContext.mockResolvedValue(thread);
      const response = { messages: [], total: 0, page: 1, limit: 20 };
      mockMessageService.getThreadMessages.mockResolvedValue(response as any);

      const result = await controller.getFormSubmissionMessages(formSubmissionId, '1', '20', user);

      expect(mockMessageService.getThreadMessages).toHaveBeenCalledWith({
        threadId: thread._id.toString(),
        user,
        page: 1,
        limit: 20,
      });
      expect(result).toEqual(response);
    });

    it('throws NotFoundException when no thread exists for the form submission', async () => {
      mockThreadService.getThreadByContext.mockResolvedValue(null);

      await expect(controller.getFormSubmissionMessages(formSubmissionId, '1', '20', user)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('markFormSubmissionThreadAsRead()', () => {
    it('resolves the thread then marks it as read', async () => {
      const thread = { _id: new Types.ObjectId(threadId) } as any;
      mockThreadService.getThreadByContext.mockResolvedValue(thread);
      mockMessageService.markThreadAsRead.mockResolvedValue(undefined);

      await controller.markFormSubmissionThreadAsRead(formSubmissionId, user);

      expect(mockMessageService.markThreadAsRead).toHaveBeenCalledWith(thread._id.toString(), user);
    });

    it('throws NotFoundException when no thread exists for the form submission', async () => {
      mockThreadService.getThreadByContext.mockResolvedValue(null);

      await expect(controller.markFormSubmissionThreadAsRead(formSubmissionId, user)).rejects.toThrow(
        NotFoundException,
      );
    });
  });
});
