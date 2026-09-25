import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { NotFoundException } from '@nestjs/common';
import { Types } from 'mongoose';
import { VisitSession } from 'src/schemas/visit-session.schema';
import { VisitSessionService } from './visit-session.service';

describe('VisitSessionService', () => {
  let service: VisitSessionService;
  let visitSessionModel: {
    create: jest.Mock;
    updateOne: jest.Mock;
    countDocuments: jest.Mock;
  };

  beforeEach(async () => {
    visitSessionModel = {
      create: jest.fn(),
      updateOne: jest.fn(),
      countDocuments: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        VisitSessionService,
        { provide: getModelToken(VisitSession.name), useValue: visitSessionModel },
      ],
    }).compile();

    service = module.get<VisitSessionService>(VisitSessionService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('startSession', () => {
    it('creates a new session document and returns its id', async () => {
      const id = new Types.ObjectId();
      visitSessionModel.create.mockResolvedValue({ _id: id });

      const result = await service.startSession();

      expect(visitSessionModel.create).toHaveBeenCalledWith({});
      expect(result).toEqual({ _id: id });
    });

    it('propagates errors from the model', async () => {
      visitSessionModel.create.mockRejectedValue(new Error('write failed'));

      await expect(service.startSession()).rejects.toThrow('write failed');
    });
  });

  describe('endSession', () => {
    it('throws NotFoundException for a malformed id without querying the model', async () => {
      await expect(service.endSession('not-an-id')).rejects.toThrow(NotFoundException);
      await expect(service.endSession('not-an-id')).rejects.toThrow('Invalid session id');
      expect(visitSessionModel.updateOne).not.toHaveBeenCalled();
    });

    it('marks the session inactive and returns the modified count', async () => {
      const id = new Types.ObjectId().toString();
      visitSessionModel.updateOne.mockResolvedValue({ matchedCount: 1, modifiedCount: 1 });

      const result = await service.endSession(id);

      expect(visitSessionModel.updateOne).toHaveBeenCalledWith(
        { _id: new Types.ObjectId(id) },
        { $set: { isActive: false } },
      );
      expect(result).toEqual({ modified: 1 });
    });

    it('throws NotFoundException when no session matches the id', async () => {
      const id = new Types.ObjectId().toString();
      visitSessionModel.updateOne.mockResolvedValue({ matchedCount: 0, modifiedCount: 0 });

      await expect(service.endSession(id)).rejects.toThrow(NotFoundException);
      await expect(service.endSession(id)).rejects.toThrow('Session not found');
    });

    it('returns modified: 0 when the session matched but was already inactive (no-op update)', async () => {
      const id = new Types.ObjectId().toString();
      visitSessionModel.updateOne.mockResolvedValue({ matchedCount: 1, modifiedCount: 0 });

      const result = await service.endSession(id);

      expect(result).toEqual({ modified: 0 });
    });
  });

  describe('visitCount', () => {
    it('returns the total number of session documents', async () => {
      visitSessionModel.countDocuments.mockResolvedValue(42);

      const result = await service.visitCount();

      expect(visitSessionModel.countDocuments).toHaveBeenCalledWith();
      expect(result).toBe(42);
    });

    it('propagates errors from the model', async () => {
      visitSessionModel.countDocuments.mockRejectedValue(new Error('connection lost'));

      await expect(service.visitCount()).rejects.toThrow('connection lost');
    });
  });
});
