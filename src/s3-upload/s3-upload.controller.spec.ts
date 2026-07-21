import { Test, TestingModule } from '@nestjs/testing';
import { S3UploadController } from './s3-upload.controller';
import { S3UploadService } from './s3-upload.service';
import { S3UrlItemDto, S3UrlResult } from './dto/s3-url-item.dto';

describe('S3UploadController', () => {
  let controller: S3UploadController;
  let service: jest.Mocked<S3UploadService>;

  beforeEach(async () => {
    const mockService = {
      generatePutSignedUrl: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [S3UploadController],
      providers: [{ provide: S3UploadService, useValue: mockService }],
    }).compile();

    controller = module.get<S3UploadController>(S3UploadController);
    service = module.get(S3UploadService);
  });

  afterEach(() => jest.clearAllMocks());

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('getSignedUrls', () => {
    it('calls generatePutSignedUrl for every item and returns the results in order', async () => {
      const items = [
        { fileName: 'a.pdf', mimeType: 'application/pdf' },
        { fileName: 'b.pdf', mimeType: 'application/pdf' },
      ] as S3UrlItemDto[];
      const resultA = { url: 'url-a', fileAlias: 'a.pdf', fileUrl: 'file-a', path: 'a', fileSize: null, pages: undefined } as S3UrlResult;
      const resultB = { url: 'url-b', fileAlias: 'b.pdf', fileUrl: 'file-b', path: 'b', fileSize: null, pages: undefined } as S3UrlResult;

      service.generatePutSignedUrl.mockResolvedValueOnce(resultA).mockResolvedValueOnce(resultB);

      const result = await controller.getSignedUrls(items);

      expect(service.generatePutSignedUrl).toHaveBeenCalledTimes(2);
      expect(service.generatePutSignedUrl).toHaveBeenNthCalledWith(1, items[0]);
      expect(service.generatePutSignedUrl).toHaveBeenNthCalledWith(2, items[1]);
      expect(result).toEqual([resultA, resultB]);
    });

    it('returns an empty array when given an empty array', async () => {
      const result = await controller.getSignedUrls([]);
      expect(result).toEqual([]);
      expect(service.generatePutSignedUrl).not.toHaveBeenCalled();
    });

    it('propagates a rejection from the service for any item', async () => {
      const items = [{ fileName: 'bad.js', mimeType: 'text/javascript' }] as S3UrlItemDto[];
      service.generatePutSignedUrl.mockRejectedValue(new Error('invalid file type'));

      await expect(controller.getSignedUrls(items)).rejects.toThrow('invalid file type');
    });
  });
});
