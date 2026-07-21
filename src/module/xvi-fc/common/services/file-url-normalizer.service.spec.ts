import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { FileUrlNormalizerService } from './file-url-normalizer.service';
import { FileTokenService } from 'src/core/file-token/file-token.service';

describe('FileUrlNormalizerService', () => {
  let service: FileUrlNormalizerService;
  let mockConfig: { get: jest.Mock };
  let mockFileTokenService: { parseToken: jest.Mock };

  let config: Record<string, string>;

  beforeEach(async () => {
    config = {
      BASE_URL: 'https://app.example.com',
      AWS_STORAGE_URL: 'https://s3.example.com/bucket/',
    };
    mockConfig = {
      get: jest.fn((key: string, defaultValue?: string) => config[key] ?? defaultValue ?? ''),
    };
    mockFileTokenService = { parseToken: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FileUrlNormalizerService,
        { provide: ConfigService, useValue: mockConfig },
        { provide: FileTokenService, useValue: mockFileTokenService },
      ],
    }).compile();

    service = module.get(FileUrlNormalizerService);
  });

  afterEach(() => jest.clearAllMocks());

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('toRawStoragePath', () => {
    it('returns falsy input unchanged (empty string)', () => {
      expect(service.toRawStoragePath('')).toBe('');
    });

    it('returns a raw S3-relative path unchanged when it does not match the signed-URL prefix', () => {
      const raw = 'state/2026-27/report.xlsx';
      expect(service.toRawStoragePath(raw)).toBe(raw);
      expect(mockFileTokenService.parseToken).not.toHaveBeenCalled();
    });

    it('decodes a signed URL and strips the AWS_STORAGE_URL prefix from the decoded path', () => {
      mockFileTokenService.parseToken.mockReturnValue({
        path: 'https://s3.example.com/bucket/state/2026-27/report.xlsx',
      });
      const signedUrl = 'https://app.example.com/file/download?signature=abc123';

      const result = service.toRawStoragePath(signedUrl);

      expect(mockFileTokenService.parseToken).toHaveBeenCalledWith('abc123');
      expect(result).toBe('state/2026-27/report.xlsx');
    });

    it('returns the decoded path unchanged when it does not start with AWS_STORAGE_URL', () => {
      mockFileTokenService.parseToken.mockReturnValue({ path: 'state/2026-27/report.xlsx' });
      const signedUrl = 'https://app.example.com/file/download?signature=abc123';

      const result = service.toRawStoragePath(signedUrl);

      expect(result).toBe('state/2026-27/report.xlsx');
    });

    it('throws BadRequestException when the token fails to parse (expired/invalid)', () => {
      mockFileTokenService.parseToken.mockImplementation(() => {
        throw { type: 'invalid' };
      });
      const signedUrl = 'https://app.example.com/file/download?signature=bad-token';

      expect(() => service.toRawStoragePath(signedUrl)).toThrow(BadRequestException);
      expect(() => service.toRawStoragePath(signedUrl)).toThrow(
        'The file URL has expired. Please reload the page and try again.',
      );
    });

    it('handles a BASE_URL without a trailing slash by normalizing it', () => {
      config['BASE_URL'] = 'https://app.example.com';
      mockFileTokenService.parseToken.mockReturnValue({ path: 'state/report.xlsx' });

      const result = service.toRawStoragePath('https://app.example.com/file/download?signature=xyz');

      expect(result).toBe('state/report.xlsx');
    });

    it('handles a BASE_URL with a trailing slash without double-slashing the prefix', () => {
      config['BASE_URL'] = 'https://app.example.com/';
      mockFileTokenService.parseToken.mockReturnValue({ path: 'state/report.xlsx' });

      const result = service.toRawStoragePath('https://app.example.com/file/download?signature=xyz');

      expect(mockFileTokenService.parseToken).toHaveBeenCalledWith('xyz');
      expect(result).toBe('state/report.xlsx');
    });

    it('treats a path as raw (not signed) when BASE_URL is empty and value has no signed prefix', () => {
      config['BASE_URL'] = '';
      const raw = 'state/2026-27/report.xlsx';
      expect(service.toRawStoragePath(raw)).toBe(raw);
    });

    it('recognizes the signed prefix when BASE_URL is empty (prefix becomes "file/download?signature=")', () => {
      config['BASE_URL'] = '';
      mockFileTokenService.parseToken.mockReturnValue({ path: 'state/report.xlsx' });

      const result = service.toRawStoragePath('file/download?signature=xyz');

      expect(mockFileTokenService.parseToken).toHaveBeenCalledWith('xyz');
      expect(result).toBe('state/report.xlsx');
    });

    it('returns the decoded path unchanged when AWS_STORAGE_URL is not configured', () => {
      config['BASE_URL'] = 'https://app.example.com';
      config['AWS_STORAGE_URL'] = '';
      mockFileTokenService.parseToken.mockReturnValue({ path: 'https://s3.example.com/bucket/state/report.xlsx' });

      const result = service.toRawStoragePath('https://app.example.com/file/download?signature=xyz');

      expect(result).toBe('https://s3.example.com/bucket/state/report.xlsx');
      config['AWS_STORAGE_URL'] = 'https://s3.example.com/bucket/';
    });
  });
});
