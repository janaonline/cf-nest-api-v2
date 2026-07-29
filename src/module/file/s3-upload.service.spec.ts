import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { S3UploadService } from './s3-upload.service';
import { S3Service } from 'src/core/s3/s3.service';
import { S3UrlItemDto } from './dto/s3-url-item.dto';

jest.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: jest.fn(),
}));

jest.mock('crypto', () => ({
  ...jest.requireActual('crypto'),
  randomUUID: jest.fn(),
}));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { randomUUID } = require('crypto');

describe('S3UploadService', () => {
  let service: S3UploadService;
  let mockS3Service: { bucket: string; client: object; getKeyFromS3Url: jest.Mock };

  const mockedGetSignedUrl = getSignedUrl as jest.Mock;
  const mockedRandomUUID = randomUUID as jest.Mock;

  const baseItem = (overrides: Partial<S3UrlItemDto> = {}): S3UrlItemDto =>
    ({
      fileName: 'report.pdf',
      mimeType: 'application/pdf',
      fileSize: 1024,
      pages: 2,
      ...overrides,
    }) as S3UrlItemDto;

  beforeEach(async () => {
    mockS3Service = {
      bucket: 'test-bucket',
      client: { send: jest.fn() },
      getKeyFromS3Url: jest.fn().mockReturnValue('resolved/key/report.pdf'),
    };
    mockedGetSignedUrl.mockResolvedValue('https://s3.example.com/test-bucket/report.pdf?X-Amz-Signature=abc');
    mockedRandomUUID.mockReturnValue('11111111-2222-3333-4444-555555555555');

    const module: TestingModule = await Test.createTestingModule({
      providers: [S3UploadService, { provide: S3Service, useValue: mockS3Service }],
    }).compile();

    service = module.get<S3UploadService>(S3UploadService);
  });

  afterEach(() => jest.clearAllMocks());

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('generatePutSignedUrl - happy path', () => {
    it('generates a fileAlias using a random UUID when no uploadId is supplied', async () => {
      const result = await service.generatePutSignedUrl(baseItem());

      expect(result.fileAlias).toBe('report_11111111-2222-3333-4444-555555555555.pdf');
      expect(mockedGetSignedUrl).toHaveBeenCalledTimes(1);
    });

    it('uses the caller-supplied uploadId as the filename when provided', async () => {
      const item = baseItem({ uploadId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee' });

      const result = await service.generatePutSignedUrl(item);

      expect(result.fileAlias).toBe('aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee.pdf');
      expect(result.uploadId).toBe('aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee');
    });

    it('prefixes the key with the folder when one is supplied', async () => {
      const item = baseItem({ folder: 'xvi-fc/ulb/annual-accounts' });

      await service.generatePutSignedUrl(item);

      // getSignedUrl(client, command, opts) — inspect the PutObjectCommand input.
      const commandArg = mockedGetSignedUrl.mock.calls[0][1];
      expect(commandArg.input.Key).toBe('xvi-fc/ulb/annual-accounts/report_11111111-2222-3333-4444-555555555555.pdf');
      expect(commandArg.input.Bucket).toBe('test-bucket');
    });

    it('omits the folder prefix from the key when no folder is supplied', async () => {
      await service.generatePutSignedUrl(baseItem());

      const commandArg = mockedGetSignedUrl.mock.calls[0][1];
      expect(commandArg.input.Key).toBe('report_11111111-2222-3333-4444-555555555555.pdf');
    });

    it('uses the default expiresIn (216000s) when item.expiresIn is not set', async () => {
      await service.generatePutSignedUrl(baseItem());

      const opts = mockedGetSignedUrl.mock.calls[0][2];
      expect(opts).toEqual({ expiresIn: 216000 });
    });

    it('uses the caller-supplied expiresIn when provided', async () => {
      await service.generatePutSignedUrl(baseItem({ expiresIn: 3600 }));

      const opts = mockedGetSignedUrl.mock.calls[0][2];
      expect(opts).toEqual({ expiresIn: 3600 });
    });

    it('strips the query string from the signed url to build fileUrl, and derives path via S3Service', async () => {
      const result = await service.generatePutSignedUrl(baseItem());

      expect(result.fileUrl).toBe('https://s3.example.com/test-bucket/report.pdf');
      expect(mockS3Service.getKeyFromS3Url).toHaveBeenCalledWith('https://s3.example.com/test-bucket/report.pdf');
      expect(result.path).toBe('resolved/key/report.pdf');
    });

    it('passes fileSize, pages, and uploadId through to the result unchanged', async () => {
      const item = baseItem({ fileSize: 2048, pages: 5, uploadId: 'bbbbbbbb-cccc-dddd-eeee-ffffffffffff' });

      const result = await service.generatePutSignedUrl(item);

      expect(result.fileSize).toBe(2048);
      expect(result.pages).toBe(5);
      expect(result.uploadId).toBe('bbbbbbbb-cccc-dddd-eeee-ffffffffffff');
    });
  });

  describe('generatePutSignedUrl - file type / name validation', () => {
    it.each(['virus.exe', 'legacy.asp', 'page.aspx', 'style.css', 'flash.swf', 'doc.shtml', 'view.jsp', 'run.pl', 'index.php', 'script.cgi', 'archive.zip', 'bundle.js'])(
      'rejects disallowed web-executable extension: %s',
      async (fileName) => {
        await expect(service.generatePutSignedUrl(baseItem({ fileName }))).rejects.toThrow(BadRequestException);
      },
    );

    it('allows a standard document extension such as .pdf', async () => {
      await expect(service.generatePutSignedUrl(baseItem({ fileName: 'report.pdf' }))).resolves.toBeDefined();
    });

    it('allows a filename with no extension', async () => {
      await expect(service.generatePutSignedUrl(baseItem({ fileName: 'noextension' }))).resolves.toBeDefined();
    });

    it('sanitizes special characters out of the filename rather than throwing, since they are stripped before the SPECIAL_CHARS check runs', async () => {
      // NOTE: the sanitize regex (replace(/([^a-z0-9_.-]+)/gi, '')) already strips every
      // character in SPECIAL_CHARS before that check runs, so the "should not contain
      // special characters" BadRequestException branch is effectively unreachable from
      // any input. This test documents current behavior rather than the intent implied
      // by the error message.
      const result = await service.generatePutSignedUrl(baseItem({ fileName: `weird*name?.pdf` }));
      expect(result.fileAlias).toBe('weirdname_11111111-2222-3333-4444-555555555555.pdf');
    });
  });

  describe('generatePutSignedUrl - folder path validation', () => {
    it('rejects a folder starting with /', async () => {
      await expect(service.generatePutSignedUrl(baseItem({ folder: '/xvi-fc' }))).rejects.toThrow(
        BadRequestException,
      );
    });

    it('rejects a folder containing ..', async () => {
      await expect(service.generatePutSignedUrl(baseItem({ folder: 'xvi-fc/../etc' }))).rejects.toThrow(
        BadRequestException,
      );
    });

    it('rejects a folder containing //', async () => {
      await expect(service.generatePutSignedUrl(baseItem({ folder: 'xvi-fc//ulb' }))).rejects.toThrow(
        BadRequestException,
      );
    });

    it('rejects a folder with an empty segment (trailing slash)', async () => {
      await expect(service.generatePutSignedUrl(baseItem({ folder: 'xvi-fc/ulb/' }))).rejects.toThrow(
        BadRequestException,
      );
    });

    it('accepts a well-formed nested folder path', async () => {
      await expect(service.generatePutSignedUrl(baseItem({ folder: 'xvi-fc/ulb/annual-accounts' }))).resolves.toBeDefined();
    });
  });

  describe('generatePutSignedUrl - error propagation', () => {
    it('propagates errors thrown by getSignedUrl', async () => {
      mockedGetSignedUrl.mockRejectedValue(new Error('presign failed'));

      await expect(service.generatePutSignedUrl(baseItem())).rejects.toThrow('presign failed');
    });
  });
});
