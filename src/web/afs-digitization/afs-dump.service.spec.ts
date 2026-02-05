import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { AfsDumpService } from './afs-dump.service';
import { State } from 'src/schemas/state.schema';
import { Ulb } from 'src/schemas/ulb.schema';
import { Year } from 'src/schemas/year.schema';
import { AfsExcelFile } from 'src/schemas/afs/afs-excel-file.schema';
import { AnnualAccountData } from 'src/schemas/annual-account-data.schema';
import { DigitizationLog } from 'src/schemas/digitization-log.schema';
import { Buffer } from 'buffer';
import { Types } from 'mongoose';

describe('AfsDumpService', () => {
  let service: AfsDumpService;
  let mockStateModel: any;
  let mockUlbModel: any;
  let mockYearModel: any;
  let mockAfsExcelFileModel: any;
  let mockAnnualAccountModel: any;
  let mockDigitizationModel: any;

  beforeEach(async () => {
    mockStateModel = {
      find: jest.fn().mockResolvedValue([{ _id: 'state1', name: 'State 1' }]),
    };

    mockUlbModel = {
      find: jest.fn().mockResolvedValue([{ _id: 'ulb1', name: 'ULB 1' }]),
    };

    mockYearModel = {
      find: jest.fn().mockResolvedValue([{ _id: 'year1', year: 2021 }]),
    };

    mockAfsExcelFileModel = {
      find: jest.fn().mockResolvedValue([]),
    };

    mockAnnualAccountModel = {
      aggregate: jest.fn().mockReturnValue({
        exec: jest.fn().mockResolvedValue([
          {
            _id: 'aa1',
            year: 2021,
            ulb: { name: 'ULB 1', population: 50000 },
            afsExcelFiles: [
              {
                fileName: 'file.pdf',
                documentType: 'bal_sheet',
                status: 'digitized',
              },
            ],
          },
        ]),
      }),
    };

    mockDigitizationModel = {
      find: jest.fn().mockResolvedValue([]),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AfsDumpService,
        {
          provide: getModelToken(State.name),
          useValue: mockStateModel,
        },
        {
          provide: getModelToken(Ulb.name),
          useValue: mockUlbModel,
        },
        {
          provide: getModelToken(Year.name),
          useValue: mockYearModel,
        },
        {
          provide: getModelToken(AfsExcelFile.name),
          useValue: mockAfsExcelFileModel,
        },
        {
          provide: getModelToken(AnnualAccountData.name),
          useValue: mockAnnualAccountModel,
        },
        {
          provide: getModelToken(DigitizationLog.name, 'digitization_db'),
          useValue: mockDigitizationModel,
        },
      ],
    }).compile();

    service = module.get<AfsDumpService>(AfsDumpService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('exportAfsExcelFiles', () => {
    it('should export AFS Excel files as buffer', async () => {
      const query = { yearId: new Types.ObjectId().toString(), docType: 'bal_sheet' };

      const result = await service.exportAfsExcelFiles(query as any);

      expect(result).toBeInstanceOf(Buffer);
      expect(result.length).toBeGreaterThan(0);
    });

    it('should call aggregate with query', async () => {
      const query = { yearId: new Types.ObjectId().toString(), docType: 'bal_sheet' };

      await service.exportAfsExcelFiles(query as any);

      expect(mockAnnualAccountModel.aggregate).toHaveBeenCalled();
    });

    it('should handle empty data', async () => {
      mockAnnualAccountModel.aggregate.mockReturnValue({
        exec: jest.fn().mockResolvedValue([]),
      });

      const query = { yearId: new Types.ObjectId().toString(), docType: 'bal_sheet' };

      const result = await service.exportAfsExcelFiles(query as any);

      expect(result).toBeInstanceOf(Buffer);
    });

    it('should create Excel workbook with correct structure', async () => {
      const query = { yearId: new Types.ObjectId().toString(), docType: 'bal_sheet' };

      const result = await service.exportAfsExcelFiles(query as any);

      // Verify it's a valid Excel file by checking buffer magic bytes (PK signature for zip)
      expect(result[0]).toBe(0x50); // 'P' of PK
      expect(result[1]).toBe(0x4b); // 'K' of PK
    });

    it('should process multiple records', async () => {
      const multipleRecords = [
        { _id: 'aa1', year: 2021, ulb: { name: 'ULB 1' } },
        { _id: 'aa2', year: 2021, ulb: { name: 'ULB 2' } },
      ];
      mockAnnualAccountModel.aggregate.mockReturnValue({
        exec: jest.fn().mockResolvedValue(multipleRecords),
      });

      const query = { yearId: new Types.ObjectId().toString(), docType: 'bal_sheet' };

      const result = await service.exportAfsExcelFiles(query as any);

      expect(result).toBeInstanceOf(Buffer);
    });
  });
});
