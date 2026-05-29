import { ConflictException, NotFoundException } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { Test, TestingModule } from '@nestjs/testing';
import { Types } from 'mongoose';
import { Ulb } from 'src/schemas/ulb.schema';
import { Year } from 'src/schemas/year.schema';
import { DataCollectionReferenceResolverService } from './data-collection-reference-resolver.service';

const ulbId = new Types.ObjectId('5dd24729437ba31f7eb42eee');
const stateId = new Types.ObjectId('5dcf9d7216a06aed41c748dd');
const yearId = new Types.ObjectId('606aafb14dff55e6c075d3ae');

const mockUlbModel = { find: jest.fn() };
const mockYearModel = { findOne: jest.fn() };

describe('DataCollectionReferenceResolverService', () => {
  let service: DataCollectionReferenceResolverService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DataCollectionReferenceResolverService,
        { provide: getModelToken(Ulb.name), useValue: mockUlbModel },
        { provide: getModelToken(Year.name), useValue: mockYearModel },
      ],
    }).compile();

    service = module.get<DataCollectionReferenceResolverService>(DataCollectionReferenceResolverService);
  });

  it('should be defined', () => expect(service).toBeDefined());

  // ─── resolveUlbByCode ─────────────────────────────────────────────────────

  describe('resolveUlbByCode', () => {
    it('returns ulbId and stateId when exactly one match is found', async () => {
      mockUlbModel.find.mockReturnValue({ lean: jest.fn().mockResolvedValue([{ _id: ulbId, state: stateId }]) });
      const result = await service.resolveUlbByCode('C001');
      expect(result).toEqual({ ulbId, stateId });
    });

    it('queries by censusCode OR sbCode', async () => {
      mockUlbModel.find.mockReturnValue({ lean: jest.fn().mockResolvedValue([{ _id: ulbId, state: stateId }]) });
      await service.resolveUlbByCode('C001');
      const queryArg = (mockUlbModel.find.mock.calls[0] as unknown[])[0] as Record<string, unknown>;
      expect(queryArg).toMatchObject({ $or: [{ censusCode: 'C001' }, { sbCode: 'C001' }] });
    });

    it('throws NotFoundException when no ULB matches the code', async () => {
      mockUlbModel.find.mockReturnValue({ lean: jest.fn().mockResolvedValue([]) });
      await expect(service.resolveUlbByCode('UNKNOWN')).rejects.toThrow(NotFoundException);
    });

    it('NotFoundException message contains the requested code', async () => {
      mockUlbModel.find.mockReturnValue({ lean: jest.fn().mockResolvedValue([]) });
      await expect(service.resolveUlbByCode('UNKNOWN')).rejects.toThrow("ULB with code 'UNKNOWN' not found.");
    });

    it('throws ConflictException when multiple ULBs match the code', async () => {
      mockUlbModel.find.mockReturnValue({
        lean: jest.fn().mockResolvedValue([
          { _id: ulbId, state: stateId },
          { _id: new Types.ObjectId(), state: stateId },
        ]),
      });
      await expect(service.resolveUlbByCode('C001')).rejects.toThrow(ConflictException);
    });

    it('ConflictException message contains the requested code', async () => {
      mockUlbModel.find.mockReturnValue({
        lean: jest.fn().mockResolvedValue([
          { _id: ulbId, state: stateId },
          { _id: new Types.ObjectId(), state: stateId },
        ]),
      });
      await expect(service.resolveUlbByCode('C001')).rejects.toThrow("Multiple ULBs found for code 'C001'.");
    });

    it('requests _id and state (stateId) projection — no extra fields', async () => {
      mockUlbModel.find.mockReturnValue({ lean: jest.fn().mockResolvedValue([{ _id: ulbId, state: stateId }]) });
      await service.resolveUlbByCode('C001');
      const projectionArg = (mockUlbModel.find.mock.calls[0] as unknown[])[1] as Record<string, unknown>;
      expect(projectionArg).toEqual({ _id: 1, state: 1 });
    });

    it('result.ulbId matches the DB _id', async () => {
      mockUlbModel.find.mockReturnValue({ lean: jest.fn().mockResolvedValue([{ _id: ulbId, state: stateId }]) });
      const result = await service.resolveUlbByCode('C001');
      expect(result.ulbId).toBe(ulbId);
    });

    it('result.stateId matches the ULB state field', async () => {
      mockUlbModel.find.mockReturnValue({ lean: jest.fn().mockResolvedValue([{ _id: ulbId, state: stateId }]) });
      const result = await service.resolveUlbByCode('C001');
      expect(result.stateId).toBe(stateId);
    });
  });

  // ─── resolveYearByCode ────────────────────────────────────────────────────

  describe('resolveYearByCode', () => {
    it('returns yearId and yearCode when a match is found', async () => {
      mockYearModel.findOne.mockReturnValue({
        lean: jest.fn().mockResolvedValue({ _id: yearId, year: '2021-22' }),
      });
      const result = await service.resolveYearByCode('2021-22');
      expect(result).toEqual({ yearId, yearCode: '2021-22' });
    });

    it('queries by the year field', async () => {
      mockYearModel.findOne.mockReturnValue({
        lean: jest.fn().mockResolvedValue({ _id: yearId, year: '2021-22' }),
      });
      await service.resolveYearByCode('2021-22');
      const queryArg = (mockYearModel.findOne.mock.calls[0] as unknown[])[0] as Record<string, unknown>;
      expect(queryArg).toEqual({ year: '2021-22' });
    });

    it('throws NotFoundException when year code is not found', async () => {
      mockYearModel.findOne.mockReturnValue({ lean: jest.fn().mockResolvedValue(null) });
      await expect(service.resolveYearByCode('9999-00')).rejects.toThrow(NotFoundException);
    });

    it('NotFoundException message contains the requested year code', async () => {
      mockYearModel.findOne.mockReturnValue({ lean: jest.fn().mockResolvedValue(null) });
      await expect(service.resolveYearByCode('9999-00')).rejects.toThrow("Year '9999-00' not found.");
    });

    it('requests _id and year projection — no extra fields', async () => {
      mockYearModel.findOne.mockReturnValue({
        lean: jest.fn().mockResolvedValue({ _id: yearId, year: '2021-22' }),
      });
      await service.resolveYearByCode('2021-22');
      const projectionArg = (mockYearModel.findOne.mock.calls[0] as unknown[])[1] as Record<string, unknown>;
      expect(projectionArg).toEqual({ _id: 1, year: 1 });
    });

    it('result.yearId matches the DB _id', async () => {
      mockYearModel.findOne.mockReturnValue({
        lean: jest.fn().mockResolvedValue({ _id: yearId, year: '2021-22' }),
      });
      const result = await service.resolveYearByCode('2021-22');
      expect(result.yearId).toBe(yearId);
    });

    it('result.yearCode is the canonical year string from DB', async () => {
      mockYearModel.findOne.mockReturnValue({
        lean: jest.fn().mockResolvedValue({ _id: yearId, year: '2021-22' }),
      });
      const result = await service.resolveYearByCode('2021-22');
      expect(result.yearCode).toBe('2021-22');
    });
  });
});
