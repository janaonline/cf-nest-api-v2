import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { Types } from 'mongoose';
import { THREAD_PERMISSION } from '../../../common/constants/communication.constants';
import { ThreadParticipant } from '../schemas/thread-participant.schema';
import { ThreadParticipantService } from './thread-participant.service';

describe('ThreadParticipantService', () => {
  let service: ThreadParticipantService;
  let mockParticipantModel: {
    findOneAndUpdate: jest.Mock;
    findOne: jest.Mock;
    find: jest.Mock;
    findOneAndDelete: jest.Mock;
  };

  const threadId = new Types.ObjectId().toString();

  beforeEach(async () => {
    mockParticipantModel = {
      findOneAndUpdate: jest.fn(),
      findOne: jest.fn(),
      find: jest.fn(),
      findOneAndDelete: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ThreadParticipantService,
        { provide: getModelToken(ThreadParticipant.name), useValue: mockParticipantModel },
      ],
    }).compile();

    service = module.get<ThreadParticipantService>(ThreadParticipantService);
  });

  afterEach(() => jest.clearAllMocks());

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  // ─── addUserParticipant ─────────────────────────────────────────────────

  describe('addUserParticipant()', () => {
    it('upserts a USER participant with default READ + REPLY permissions', async () => {
      const exec = jest.fn().mockResolvedValue({ _id: new Types.ObjectId() });
      mockParticipantModel.findOneAndUpdate.mockReturnValue({ exec });

      const userId = new Types.ObjectId().toString();
      await service.addUserParticipant(threadId, userId);

      expect(mockParticipantModel.findOneAndUpdate).toHaveBeenCalledWith(
        expect.objectContaining({ participantType: 'USER', participantId: userId }),
        expect.objectContaining({
          $setOnInsert: expect.objectContaining({
            permissions: [THREAD_PERMISSION.READ, THREAD_PERMISSION.REPLY],
          }),
        }),
        expect.objectContaining({ upsert: true, new: true }),
      );
      expect(exec).toHaveBeenCalled();
    });

    it('uses custom permissions when provided', async () => {
      const exec = jest.fn().mockResolvedValue({});
      mockParticipantModel.findOneAndUpdate.mockReturnValue({ exec });

      const userId = new Types.ObjectId().toString();
      await service.addUserParticipant(threadId, userId, [THREAD_PERMISSION.READ]);

      const [, update] = mockParticipantModel.findOneAndUpdate.mock.calls[0];
      expect(update.$setOnInsert.permissions).toEqual([THREAD_PERMISSION.READ]);
    });

    it('includes the session in the update options when provided', async () => {
      const exec = jest.fn().mockResolvedValue({});
      mockParticipantModel.findOneAndUpdate.mockReturnValue({ exec });
      const session = { id: 'fake-session' } as any;

      await service.addUserParticipant(threadId, 'user1', undefined, session);

      const [, , options] = mockParticipantModel.findOneAndUpdate.mock.calls[0];
      expect(options.session).toBe(session);
    });
  });

  // ─── addRoleGroupParticipant ────────────────────────────────────────────

  describe('addRoleGroupParticipant()', () => {
    it('upserts a ROLE_GROUP participant with a composite participantId', async () => {
      const exec = jest.fn().mockResolvedValue({});
      mockParticipantModel.findOneAndUpdate.mockReturnValue({ exec });

      const orgId = new Types.ObjectId();
      await service.addRoleGroupParticipant(threadId, 'ULB', orgId, 'ULB');

      const [filter, update] = mockParticipantModel.findOneAndUpdate.mock.calls[0];
      expect(filter.participantId).toBe(`ULB:${orgId.toString()}:ULB`);
      expect(update.$setOnInsert.participantType).toBe('ROLE_GROUP');
      expect(update.$setOnInsert.orgId).toBeInstanceOf(Types.ObjectId);
      expect(update.$setOnInsert.permissions).toEqual([THREAD_PERMISSION.READ, THREAD_PERMISSION.REPLY]);
    });

    it('accepts orgId as a plain string', async () => {
      const exec = jest.fn().mockResolvedValue({});
      mockParticipantModel.findOneAndUpdate.mockReturnValue({ exec });

      const orgIdStr = new Types.ObjectId().toString();
      await service.addRoleGroupParticipant(threadId, 'STATE', orgIdStr, 'STATE', [THREAD_PERMISSION.READ]);

      const [filter] = mockParticipantModel.findOneAndUpdate.mock.calls[0];
      expect(filter.participantId).toBe(`STATE:${orgIdStr}:STATE`);
    });
  });

  // ─── userHasPermission ──────────────────────────────────────────────────

  describe('userHasPermission()', () => {
    it('returns true when a matching participant record exists', async () => {
      const exec = jest.fn().mockResolvedValue({ _id: new Types.ObjectId() });
      mockParticipantModel.findOne.mockReturnValue({ lean: () => ({ exec }) });

      const result = await service.userHasPermission('user1', threadId, THREAD_PERMISSION.REPLY);

      expect(result).toBe(true);
      expect(mockParticipantModel.findOne).toHaveBeenCalledWith(
        expect.objectContaining({
          participantType: 'USER',
          participantId: 'user1',
          permissions: THREAD_PERMISSION.REPLY,
        }),
      );
    });

    it('returns false when no participant record matches', async () => {
      const exec = jest.fn().mockResolvedValue(null);
      mockParticipantModel.findOne.mockReturnValue({ lean: () => ({ exec }) });

      const result = await service.userHasPermission('user1', threadId, THREAD_PERMISSION.REPLY);

      expect(result).toBe(false);
    });
  });

  // ─── getThreadParticipants ──────────────────────────────────────────────

  describe('getThreadParticipants()', () => {
    it('returns all participants for a thread', async () => {
      const participants = [{ _id: new Types.ObjectId(), participantType: 'USER' }];
      const exec = jest.fn().mockResolvedValue(participants);
      mockParticipantModel.find.mockReturnValue({ session: () => ({ lean: () => ({ exec }) }) });

      const result = await service.getThreadParticipants(threadId);

      expect(result).toEqual(participants);
      expect(mockParticipantModel.find).toHaveBeenCalledWith({ threadId: new Types.ObjectId(threadId) });
    });

    it('returns an empty array when the thread has no participants', async () => {
      const exec = jest.fn().mockResolvedValue([]);
      mockParticipantModel.find.mockReturnValue({ session: () => ({ lean: () => ({ exec }) }) });

      const result = await service.getThreadParticipants(threadId);

      expect(result).toEqual([]);
    });
  });

  // ─── removeParticipant ──────────────────────────────────────────────────

  describe('removeParticipant()', () => {
    it('deletes the participant matching threadId and participantId', async () => {
      const exec = jest.fn().mockResolvedValue({ _id: new Types.ObjectId() });
      mockParticipantModel.findOneAndDelete.mockReturnValue({ exec });

      await service.removeParticipant(threadId, 'user1');

      expect(mockParticipantModel.findOneAndDelete).toHaveBeenCalledWith(
        { threadId: new Types.ObjectId(threadId), participantId: 'user1' },
        {},
      );
      expect(exec).toHaveBeenCalled();
    });

    it('passes the session through delete options when provided', async () => {
      const exec = jest.fn().mockResolvedValue({});
      mockParticipantModel.findOneAndDelete.mockReturnValue({ exec });
      const session = { id: 'fake-session' } as any;

      await service.removeParticipant(threadId, 'user1', session);

      const [, options] = mockParticipantModel.findOneAndDelete.mock.calls[0];
      expect(options.session).toBe(session);
    });
  });
});
