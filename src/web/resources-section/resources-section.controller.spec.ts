import { Test, TestingModule } from '@nestjs/testing';
import { ResourcesSectionController } from './resources-section.controller';
import { ResourcesSectionService } from './resources-section.service';
import { S3ZipService } from './s3-zip.service';
import { QueryResourcesSectionDto } from './dto/query-resources-section.dto';
import { Response } from 'express';

describe('ResourcesSectionController', () => {
  let controller: ResourcesSectionController;
  let resourcesSectionService: jest.Mocked<ResourcesSectionService>;
  let s3ZipService: jest.Mocked<S3ZipService>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [ResourcesSectionController],
      providers: [
        {
          provide: ResourcesSectionService,
          useValue: {
            getFiles: jest.fn(),
            zipData: jest.fn(),
          },
        },
        {
          provide: S3ZipService,
          useValue: {
            streamZip: jest.fn(),
            getSizesForFiles: jest.fn(),
          },
        },
      ],
    }).compile();

    controller = module.get<ResourcesSectionController>(ResourcesSectionController);
    resourcesSectionService = module.get(ResourcesSectionService);
    s3ZipService = module.get(S3ZipService);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('getAnnualAccounts', () => {
    it('should return files for valid query', async () => {
      const query: QueryResourcesSectionDto = {
        ulb: 'ulb-id-123',
        state: 'state-id-456',
        downloadType: 'Raw Data PDF',
        year: '2021-22',
        ulbType: 'type-1',
        popCat: '100K-500K',
        auditType: 'audited',
      };
      const mockResult = { success: true, data: [], message: 'Files retrieved' };
      resourcesSectionService.getFiles.mockResolvedValue(mockResult);

      const result = await controller.getAnnualAccounts(query);

      expect(result).toEqual(mockResult);
      expect(resourcesSectionService.getFiles).toHaveBeenCalledWith(query);
    });

    it('should handle service errors', async () => {
      const query: QueryResourcesSectionDto = {
        ulb: 'ulb-id-123',
        state: '',
        downloadType: 'Raw Data PDF',
        year: '2021-22',
        ulbType: '',
        popCat: '',
        auditType: 'audited',
      };
      const error = new Error('Service error');
      resourcesSectionService.getFiles.mockRejectedValue(error);

      await expect(controller.getAnnualAccounts(query)).rejects.toThrow('Service error');
    });
  });

  describe('getAnnualAccountsZip', () => {
    it('should return zipped data for valid query', async () => {
      const query: QueryResourcesSectionDto = {
        ulb: 'ulb-id-123',
        state: 'state-id-456',
        downloadType: 'Raw Data PDF',
        year: '2021-22',
        ulbType: 'type-1',
        popCat: '100K-500K',
        auditType: 'audited',
      };
      const mockResult = { jobId: 'job-123', status: 'processing' };
      resourcesSectionService.zipData.mockResolvedValue(mockResult);

      const result = await controller.getAnnualAccountsZip(query);

      expect(result).toEqual(mockResult);
      expect(resourcesSectionService.zipData).toHaveBeenCalledWith(query);
    });

    it('should handle zip service errors', async () => {
      const query: QueryResourcesSectionDto = {
        ulb: 'ulb-id-123',
        state: 'state-id-456',
        downloadType: 'Budget PDF',
        year: '2021-22',
        ulbType: 'type-1',
        popCat: '',
        auditType: 'audited',
      };
      const error = new Error('Zip error');
      resourcesSectionService.zipData.mockRejectedValue(error);

      await expect(controller.getAnnualAccountsZip(query)).rejects.toThrow('Zip error');
    });
  });

  describe('getAnnualAccountsDownload', () => {
    it('should stream zip file with correct headers', async () => {
      const query: QueryResourcesSectionDto = {
        ulb: 'ulb-id-123',
        state: 'state-id-456',
        downloadType: 'Raw Data PDF',
        year: '2021-22',
        ulbType: 'type-1',
        popCat: '100K-500K',
        auditType: 'audited',
      };

      const mockStream = { pipe: jest.fn() };
      s3ZipService.streamZip.mockResolvedValue(mockStream as any);

      const mockResponse = {
        setHeader: jest.fn(),
        pipe: jest.fn(),
      } as unknown as Response;

      await controller.getAnnualAccountsDownload(query, mockResponse);

      expect(s3ZipService.streamZip).toHaveBeenCalled();
      expect(mockResponse.setHeader).toHaveBeenCalledWith('Content-Type', 'application/zip');
      expect(mockResponse.setHeader).toHaveBeenCalledWith('Content-Disposition', 'attachment; filename=files.zip');
    });

    it('should handle stream errors gracefully', async () => {
      const query: QueryResourcesSectionDto = {
        ulb: 'ulb-id-123',
        state: 'state-id-456',
        downloadType: 'Raw Data PDF',
        year: '2021-22',
        ulbType: 'type-1',
        popCat: '100K-500K',
        auditType: 'audited',
      };

      const error = new Error('Stream error');
      s3ZipService.streamZip.mockRejectedValue(error);

      const mockResponse = {
        setHeader: jest.fn(),
      } as unknown as Response;

      await expect(controller.getAnnualAccountsDownload(query, mockResponse)).rejects.toThrow('Stream error');
    });
  });

  describe('getSizes', () => {
    it('should return file sizes', async () => {
      const mockSizes = [
        { url: 'file1.pdf', size: 1024 },
        { url: 'file2.pdf', size: 2048 },
      ];
      s3ZipService.getSizesForFiles.mockResolvedValue(mockSizes);

      const result = await controller.getSizes();

      expect(result).toEqual(mockSizes);
      expect(s3ZipService.getSizesForFiles).toHaveBeenCalled();
    });

    it('should handle S3 errors when getting sizes', async () => {
      const error = new Error('S3 connection error');
      s3ZipService.getSizesForFiles.mockRejectedValue(error);

      await expect(controller.getSizes()).rejects.toThrow('S3 connection error');
    });
  });
});
