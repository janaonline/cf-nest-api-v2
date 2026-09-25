const mockSend = jest.fn();
const mockGetSignedUrl = jest.fn();

jest.mock('@aws-sdk/client-s3', () => ({
  S3Client: jest.fn().mockImplementation(() => ({ send: mockSend })),
  GetObjectCommand: jest.fn().mockImplementation((input: any) => ({ __cmd: 'GetObjectCommand', input })),
  HeadObjectCommand: jest.fn().mockImplementation((input: any) => ({ __cmd: 'HeadObjectCommand', input })),
  PutObjectCommand: jest.fn().mockImplementation((input: any) => ({ __cmd: 'PutObjectCommand', input })),
  CopyObjectCommand: jest.fn().mockImplementation((input: any) => ({ __cmd: 'CopyObjectCommand', input })),
}));

jest.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: (...args: any[]) => mockGetSignedUrl(...args),
}));

import { ConfigService } from '@nestjs/config';
import { S3Service } from './s3.service';

describe('S3Service', () => {
  let service: S3Service;

  const config: Record<string, string> = {
    AWS_REGION: 'ap-south-1',
    AWS_BUCKET_NAME: 'test-bucket',
    PRESIGN_EXPIRES: '604800',
  };

  const mockConfigService = {
    get: jest.fn((key: string, def?: any) => (config[key] !== undefined ? config[key] : def)),
  } as unknown as ConfigService;

  beforeEach(() => {
    service = new S3Service(mockConfigService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
    expect(service.bucket).toBe('test-bucket');
  });

  describe('headObject()', () => {
    it('should send a HeadObjectCommand with the bucket and key', async () => {
      mockSend.mockResolvedValue({ ContentLength: 100 });

      const result = await service.headObject('folder/file.pdf');

      expect(mockSend).toHaveBeenCalledWith(
        expect.objectContaining({ __cmd: 'HeadObjectCommand', input: { Bucket: 'test-bucket', Key: 'folder/file.pdf' } }),
      );
      expect(result).toEqual({ ContentLength: 100 });
    });
  });

  describe('getObjectStream()', () => {
    it('should return the Body of the GetObjectCommand response', async () => {
      const fakeBody = { fake: 'stream' };
      mockSend.mockResolvedValue({ Body: fakeBody });

      const result = await service.getObjectStream('folder/file.pdf');

      expect(mockSend).toHaveBeenCalledWith(
        expect.objectContaining({ __cmd: 'GetObjectCommand', input: { Bucket: 'test-bucket', Key: 'folder/file.pdf' } }),
      );
      expect(result).toBe(fakeBody);
    });
  });

  describe('getBuffer()', () => {
    it('should concatenate stream chunks into a Buffer', async () => {
      mockSend.mockResolvedValue({ Body: [Buffer.from('hello '), Buffer.from('world')] });

      const buffer = await service.getBuffer('https://test-bucket.s3.ap-south-1.amazonaws.com/folder/file.pdf');

      expect(buffer.toString()).toBe('hello world');
    });

    it('should wrap S3 errors with diagnostic info', async () => {
      const err: any = new Error('Access Denied');
      err.name = 'AccessDenied';
      err.$metadata = { httpStatusCode: 403 };
      mockSend.mockRejectedValue(err);

      await expect(service.getBuffer('folder/file.pdf')).rejects.toThrow(
        'S3 GetObject failed (code=AccessDenied, status=403), message=Access Denied',
      );
    });
  });

  describe('presignGet()', () => {
    it('should generate a signed URL using the configured expiry', async () => {
      mockGetSignedUrl.mockResolvedValue('https://signed-url.example.com/file.pdf');

      const url = await service.presignGet('folder/file.pdf');

      expect(mockGetSignedUrl).toHaveBeenCalledWith(
        service.client,
        expect.objectContaining({ __cmd: 'GetObjectCommand', input: { Bucket: 'test-bucket', Key: 'folder/file.pdf' } }),
        { expiresIn: 604800 },
      );
      expect(url).toBe('https://signed-url.example.com/file.pdf');
    });
  });

  describe('uploadPrivate()', () => {
    it('should upload with default pdf content type and return the key', async () => {
      mockSend.mockResolvedValue({});

      const key = await service.uploadPrivate('folder/file.pdf', Buffer.from('data'));

      expect(mockSend).toHaveBeenCalledWith(
        expect.objectContaining({
          __cmd: 'PutObjectCommand',
          input: expect.objectContaining({
            Bucket: 'test-bucket',
            Key: 'folder/file.pdf',
            ContentType: 'application/pdf',
          }),
        }),
      );
      expect(key).toBe('folder/file.pdf');
    });

    it('should respect a custom content type', async () => {
      mockSend.mockResolvedValue({});

      await service.uploadPrivate('folder/file.json', '{}', 'application/json');

      const commandArg = mockSend.mock.calls[0][0];
      expect(commandArg.input.ContentType).toBe('application/json');
    });
  });

  describe('uploadPublic()', () => {
    it('should upload with public-read ACL and return the public URL', async () => {
      mockSend.mockResolvedValue({});

      const url = await service.uploadPublic('folder/archive.zip', Buffer.from('zip'));

      expect(mockSend).toHaveBeenCalledWith(
        expect.objectContaining({
          __cmd: 'PutObjectCommand',
          input: expect.objectContaining({
            Bucket: 'test-bucket',
            Key: 'folder/archive.zip',
            ContentType: 'application/zip',
            ACL: 'public-read',
          }),
        }),
      );
      expect(url).toBe('https://test-bucket.s3.ap-south-1.amazonaws.com/folder/archive.zip');
    });
  });

  describe('getPublicUrl()', () => {
    it('should build the public S3 URL', () => {
      expect(service.getPublicUrl('a/b.txt')).toBe('https://test-bucket.s3.ap-south-1.amazonaws.com/a/b.txt');
    });
  });

  describe('copyFileBetweenBuckets()', () => {
    it('should send a CopyObjectCommand', async () => {
      mockSend.mockResolvedValue({});

      await service.copyFileBetweenBuckets('source-bucket/src.pdf', 'dest.pdf');

      expect(mockSend).toHaveBeenCalledWith(
        expect.objectContaining({
          __cmd: 'CopyObjectCommand',
          input: { Bucket: 'test-bucket', Key: 'dest.pdf', CopySource: 'source-bucket/src.pdf' },
        }),
      );
    });
  });

  describe('getKeyFromS3Url()', () => {
    it('should extract and decode the key from a full https URL', () => {
      const key = service.getKeyFromS3Url('https://test-bucket.s3.ap-south-1.amazonaws.com/folder/file%20name.pdf');
      expect(key).toBe('folder/file name.pdf');
    });

    it('should strip leading slashes and return relative paths as-is', () => {
      expect(service.getKeyFromS3Url('folder/file.pdf')).toBe('folder/file.pdf');
    });

    it('should fall back to the stripped key when decoding fails', () => {
      expect(service.getKeyFromS3Url('/folder/broken%.pdf')).toBe('folder/broken%.pdf');
    });
  });

  describe('toS3Key()', () => {
    it('should extract the pathname from a full URL', () => {
      expect(service.toS3Key('https://test-bucket.s3.ap-south-1.amazonaws.com/folder/file.pdf')).toBe(
        'folder/file.pdf',
      );
    });

    it('should treat a plain key as already being a key', () => {
      expect(service.toS3Key('folder/file.pdf')).toBe('folder/file.pdf');
    });
  });

  describe('streamToBuffer()', () => {
    it('should combine iterable chunks (Buffer and non-Buffer) into a Buffer', async () => {
      const chunks = [Buffer.from('foo'), 'bar'];
      const result = await service.streamToBuffer(chunks);
      expect(result.toString()).toBe('foobar');
    });
  });

  describe('getPdfBufferFromS3()', () => {
    it('should fetch and buffer the PDF body', async () => {
      mockSend.mockResolvedValue({ Body: [Buffer.from('%PDF-1.4')] });

      const buffer = await service.getPdfBufferFromS3('folder/doc.pdf');

      expect(buffer.toString()).toBe('%PDF-1.4');
    });

    it('should throw when the response has no Body', async () => {
      mockSend.mockResolvedValue({});

      await expect(service.getPdfBufferFromS3('folder/doc.pdf')).rejects.toThrow('S3 GetObject returned empty Body');
    });

    it('should wrap SDK errors with diagnostic info', async () => {
      const err: any = new Error('Not Found');
      err.name = 'NoSuchKey';
      err.$metadata = { httpStatusCode: 404 };
      mockSend.mockRejectedValue(err);

      await expect(service.getPdfBufferFromS3('folder/missing.pdf')).rejects.toThrow(
        'S3 GetObject failed (code=NoSuchKey, status=404), message=Not Found',
      );
    });
  });

  describe('getPdfPageCountFromBuffer()', () => {
    it('should count "/Type /Page" occurrences while excluding "/Type /Pages"', () => {
      const buffer = Buffer.from('/Type /Page\n/Type /Page\n/Type /Pages\n', 'latin1');
      expect(service.getPdfPageCountFromBuffer(buffer)).toBe(2);
    });

    it('should return 0 when there are no page markers', () => {
      const buffer = Buffer.from('no markers here', 'latin1');
      expect(service.getPdfPageCountFromBuffer(buffer)).toBe(0);
    });
  });
});
