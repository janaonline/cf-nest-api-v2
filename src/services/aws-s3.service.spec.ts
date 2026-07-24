import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { AwsS3Service } from './aws-s3.service';

const mockSend = jest.fn();

jest.mock('@aws-sdk/client-s3', () => ({
  S3Client: jest.fn().mockImplementation(() => ({ send: mockSend })),
  PutObjectCommand: jest.fn().mockImplementation((input) => ({ __type: 'Put', input })),
  GetObjectCommand: jest.fn().mockImplementation((input) => ({ __type: 'Get', input })),
}));

jest.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: jest.fn(),
}));

const mockArchiverInstance = {
  on: jest.fn(),
  pipe: jest.fn(),
  append: jest.fn(),
  finalize: jest.fn(),
};

jest.mock('archiver', () => jest.fn(() => mockArchiverInstance));

describe('AwsS3Service', () => {
  let service: AwsS3Service;
  const mockedGetSignedUrl = getSignedUrl as jest.Mock;

  const configValues: Record<string, string> = {
    AWS_REGION: 'ap-south-1',
    AWS_ACCESS_KEY_ID: 'test-access-key',
    AWS_SECRET_ACCESS_KEY: 'test-secret-key',
    AWS_BUCKET: 'test-bucket',
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    mockArchiverInstance.on.mockReturnValue(mockArchiverInstance);
    mockArchiverInstance.pipe.mockReturnValue(mockArchiverInstance);
    mockArchiverInstance.append.mockReturnValue(mockArchiverInstance);
    mockArchiverInstance.finalize.mockResolvedValue(undefined);
    mockedGetSignedUrl.mockResolvedValue('https://s3.example.com/test-bucket/out.zip?X-Amz-Signature=abc');
    mockSend.mockImplementation(async (command: { __type: string }) => {
      if (command.__type === 'Put') return {};
      if (command.__type === 'Get') return { Body: 'fake-readable-stream' };
      return {};
    });

    const mockConfigService = { get: jest.fn((key: string) => configValues[key]) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [AwsS3Service, { provide: ConfigService, useValue: mockConfigService }],
    }).compile();

    service = module.get<AwsS3Service>(AwsS3Service);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('constructs the S3Client with region and credentials from ConfigService', () => {
    expect(S3Client).toHaveBeenCalledWith({
      region: 'ap-south-1',
      credentials: {
        accessKeyId: 'test-access-key',
        secretAccessKey: 'test-secret-key',
      },
    });
  });

  describe('zipAndUpload - happy path', () => {
    it('uploads a zip built from the given keys and returns a presigned URL', async () => {
      const keys = ['folder/a.txt', 'folder/sub/b.txt'];

      const result = await service.zipAndUpload(keys, 'archives/out.zip');

      expect(result).toBe('https://s3.example.com/test-bucket/out.zip?X-Amz-Signature=abc');
    });

    it('fetches every key via GetObjectCommand and appends it to the archive under its basename', async () => {
      const keys = ['folder/a.txt', 'folder/sub/b.txt'];

      await service.zipAndUpload(keys, 'archives/out.zip');

      expect(GetObjectCommand).toHaveBeenCalledWith({ Bucket: 'test-bucket', Key: 'folder/a.txt' });
      expect(GetObjectCommand).toHaveBeenCalledWith({ Bucket: 'test-bucket', Key: 'folder/sub/b.txt' });
      expect(mockArchiverInstance.append).toHaveBeenNthCalledWith(1, 'fake-readable-stream', { name: 'a.txt' });
      expect(mockArchiverInstance.append).toHaveBeenNthCalledWith(2, 'fake-readable-stream', { name: 'b.txt' });
    });

    it('uploads the zip via PutObjectCommand with the correct bucket, key, and content type', async () => {
      await service.zipAndUpload(['a.txt'], 'archives/out.zip');

      expect(PutObjectCommand).toHaveBeenCalledWith(
        expect.objectContaining({
          Bucket: 'test-bucket',
          Key: 'archives/out.zip',
          ContentType: 'application/zip',
        }),
      );
    });

    it('requests the presigned URL for the uploaded zipKey with a 1 hour expiry', async () => {
      await service.zipAndUpload(['a.txt'], 'archives/out.zip');

      expect(mockedGetSignedUrl).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ __type: 'Get', input: { Bucket: 'test-bucket', Key: 'archives/out.zip' } }),
        { expiresIn: 3600 },
      );
    });

    it('handles an empty keys array by finalizing an empty archive', async () => {
      const result = await service.zipAndUpload([], 'archives/empty.zip');

      expect(mockArchiverInstance.append).not.toHaveBeenCalled();
      expect(mockArchiverInstance.finalize).toHaveBeenCalledTimes(1);
      expect(result).toBe('https://s3.example.com/test-bucket/out.zip?X-Amz-Signature=abc');
    });
  });

  describe('zipAndUpload - error handling', () => {
    it('rejects when fetching a source object from S3 fails', async () => {
      mockSend.mockImplementation(async (command: { __type: string }) => {
        if (command.__type === 'Get') throw new Error('object not found');
        return {};
      });

      await expect(service.zipAndUpload(['missing.txt'], 'archives/out.zip')).rejects.toThrow('object not found');
    });

    it('rejects when archive.finalize() fails', async () => {
      mockArchiverInstance.finalize.mockRejectedValue(new Error('archive corrupted'));

      await expect(service.zipAndUpload(['a.txt'], 'archives/out.zip')).rejects.toThrow('archive corrupted');
    });

    it('rejects when the zip upload (PutObjectCommand) fails', async () => {
      mockSend.mockImplementation(async (command: { __type: string }) => {
        if (command.__type === 'Put') throw new Error('upload failed');
        if (command.__type === 'Get') return { Body: 'fake-readable-stream' };
        return {};
      });

      await expect(service.zipAndUpload(['a.txt'], 'archives/out.zip')).rejects.toThrow('upload failed');
    });

    it('rejects when generating the presigned URL fails', async () => {
      mockedGetSignedUrl.mockRejectedValue(new Error('presign failed'));

      await expect(service.zipAndUpload(['a.txt'], 'archives/out.zip')).rejects.toThrow('presign failed');
    });

    it('registers an error handler on the archive stream', async () => {
      await service.zipAndUpload(['a.txt'], 'archives/out.zip');

      expect(mockArchiverInstance.on).toHaveBeenCalledWith('error', expect.any(Function));
    });
  });
});
