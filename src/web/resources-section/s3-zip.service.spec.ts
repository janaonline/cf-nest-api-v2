import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { PassThrough } from 'stream';
import { S3ZipService } from './s3-zip.service';

const mockSend = jest.fn();

jest.mock('@aws-sdk/client-s3', () => {
  return {
    S3Client: jest.fn().mockImplementation(() => ({ send: mockSend })),
    GetObjectCommand: jest.fn().mockImplementation((input) => ({ commandName: 'GetObjectCommand', input })),
    HeadObjectCommand: jest.fn().mockImplementation((input) => ({ commandName: 'HeadObjectCommand', input })),
  };
});

const mockArchiveInstance = {
  pipe: jest.fn(),
  append: jest.fn(),
  finalize: jest.fn(),
};

jest.mock('archiver', () => jest.fn(() => mockArchiveInstance));

describe('S3ZipService', () => {
  let service: S3ZipService;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        S3ZipService,
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string) => {
              const values: Record<string, string> = {
                AWS_REGION: 'ap-south-1',
                AWS_ACCESS_KEY_ID: 'access-key',
                AWS_SECRET_ACCESS_KEY: 'secret-key',
                AWS_BUCKET_NAME: 'test-bucket',
              };
              return values[key];
            }),
          },
        },
      ],
    }).compile();

    service = module.get<S3ZipService>(S3ZipService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('streamZip', () => {
    it('should build an archive from S3 objects and return a readable stream', async () => {
      mockSend.mockResolvedValue({ Body: 'fake-stream-body' });

      const result = await service.streamZip(['folder/file1.pdf', 'folder/file2.pdf']);

      expect(mockSend).toHaveBeenCalledTimes(2);
      expect(mockArchiveInstance.pipe).toHaveBeenCalled();
      expect(mockArchiveInstance.append).toHaveBeenCalledTimes(2);
      expect(mockArchiveInstance.append).toHaveBeenCalledWith('fake-stream-body', { name: 'file1.pdf' });
      expect(mockArchiveInstance.append).toHaveBeenCalledWith('fake-stream-body', { name: 'file2.pdf' });
      expect(mockArchiveInstance.finalize).toHaveBeenCalled();
      expect(result).toBeInstanceOf(PassThrough);
    });

    it('should return a stream without appending anything for an empty key list', async () => {
      const result = await service.streamZip([]);

      expect(mockSend).not.toHaveBeenCalled();
      expect(mockArchiveInstance.append).not.toHaveBeenCalled();
      expect(mockArchiveInstance.finalize).toHaveBeenCalled();
      expect(result).toBeInstanceOf(PassThrough);
    });

    it('should propagate errors from the S3 client', async () => {
      mockSend.mockRejectedValue(new Error('S3 GetObject failed'));

      await expect(service.streamZip(['folder/missing.pdf'])).rejects.toThrow('S3 GetObject failed');
    });
  });

  describe('getSizesForFiles', () => {
    it('should sum up sizes for all files', async () => {
      mockSend.mockResolvedValueOnce({ ContentLength: 100 }).mockResolvedValueOnce({ ContentLength: 300 });

      const result = await service.getSizesForFiles(['a.pdf', 'b.pdf']);

      expect(result.totalSizeBytes).toBe(400);
      expect(result.totalSizeMB).toBe((400 / (1024 * 1024)).toFixed(2));
      expect(result.files).toEqual([
        { key: 'a.pdf', size: 100 },
        { key: 'b.pdf', size: 300 },
      ]);
    });

    it('should default missing ContentLength to 0', async () => {
      mockSend.mockResolvedValue({});

      const result = await service.getSizesForFiles(['a.pdf']);

      expect(result.totalSizeBytes).toBe(0);
      expect(result.files).toEqual([{ key: 'a.pdf', size: 0 }]);
    });

    it('should mark files that fail HeadObject as missing (size -1) and continue', async () => {
      mockSend.mockResolvedValueOnce({ ContentLength: 100 }).mockRejectedValueOnce(new Error('NotFound'));

      const result = await service.getSizesForFiles(['ok.pdf', 'missing.pdf']);

      expect(result.totalSizeBytes).toBe(100);
      expect(result.files).toEqual([
        { key: 'ok.pdf', size: 100 },
        { key: 'missing.pdf', size: -1 },
      ]);
    });

    it('should decode URI-encoded keys before requesting head object', async () => {
      mockSend.mockResolvedValue({ ContentLength: 10 });

      await service.getSizesForFiles(['folder/file%20name.pdf']);

      const { HeadObjectCommand } = jest.requireMock('@aws-sdk/client-s3') as any;
      expect(HeadObjectCommand).toHaveBeenCalledWith({
        Bucket: 'test-bucket',
        Key: 'folder/file name.pdf',
      });
    });

    it('should return empty results for an empty key list', async () => {
      const result = await service.getSizesForFiles([]);

      expect(mockSend).not.toHaveBeenCalled();
      expect(result).toEqual({ totalSizeBytes: 0, totalSizeMB: '0.00', files: [] });
    });
  });
});
