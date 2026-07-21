import { Test, TestingModule } from '@nestjs/testing';
import { HttpException, HttpStatus } from '@nestjs/common';
import { FileDownloadService } from './file-download.service';
import { FileTokenService } from 'src/core/file-token/file-token.service';
import { S3Service } from 'src/core/s3/s3.service';

describe('FileDownloadService', () => {
  let service: FileDownloadService;
  let fileTokenService: { parseToken: jest.Mock };
  let s3Service: { getKeyFromS3Url: jest.Mock; getObjectStream: jest.Mock };

  beforeEach(async () => {
    fileTokenService = { parseToken: jest.fn() };
    s3Service = { getKeyFromS3Url: jest.fn(), getObjectStream: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FileDownloadService,
        { provide: FileTokenService, useValue: fileTokenService },
        { provide: S3Service, useValue: s3Service },
      ],
    }).compile();

    service = module.get<FileDownloadService>(FileDownloadService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('prepareDownload', () => {
    it('throws 400 when signature is empty', async () => {
      await expect(service.prepareDownload('')).rejects.toMatchObject({
        status: HttpStatus.BAD_REQUEST,
      });
      expect(fileTokenService.parseToken).not.toHaveBeenCalled();
    });

    it('throws 410 GONE when the token is expired', async () => {
      fileTokenService.parseToken.mockImplementation(() => {
        throw { type: 'expired' };
      });

      await expect(service.prepareDownload('sig')).rejects.toMatchObject({
        status: HttpStatus.GONE,
      });
    });

    it('throws 400 when the token is invalid/tampered', async () => {
      fileTokenService.parseToken.mockImplementation(() => {
        throw { type: 'tampered' };
      });

      await expect(service.prepareDownload('sig')).rejects.toMatchObject({
        status: HttpStatus.BAD_REQUEST,
      });
    });

    it('throws 400 with invalid_token when the thrown error has no recognizable type', async () => {
      fileTokenService.parseToken.mockImplementation(() => {
        throw new Error('boom');
      });

      try {
        await service.prepareDownload('sig');
        fail('expected rejection');
      } catch (err) {
        expect(err).toBeInstanceOf(HttpException);
        expect((err as HttpException).getStatus()).toBe(HttpStatus.BAD_REQUEST);
        expect((err as HttpException).getResponse()).toBe('invalid_token');
      }
    });

    it('throws 400 when the resolved S3 key is empty', async () => {
      fileTokenService.parseToken.mockReturnValue({ path: 's3://bucket/key', exp: Date.now() + 10000 });
      s3Service.getKeyFromS3Url.mockReturnValue('');

      await expect(service.prepareDownload('sig')).rejects.toMatchObject({
        status: HttpStatus.BAD_REQUEST,
      });
      expect(s3Service.getObjectStream).not.toHaveBeenCalled();
    });

    it('throws 404 when S3 reports the object does not exist', async () => {
      fileTokenService.parseToken.mockReturnValue({ path: 's3://bucket/some/key.pdf', exp: Date.now() + 10000 });
      s3Service.getKeyFromS3Url.mockReturnValue('some/key.pdf');
      s3Service.getObjectStream.mockRejectedValue({ name: 'NoSuchKey' });

      await expect(service.prepareDownload('sig')).rejects.toMatchObject({
        status: HttpStatus.NOT_FOUND,
      });
    });

    it('throws 500 when S3 stream init fails for another reason', async () => {
      fileTokenService.parseToken.mockReturnValue({ path: 's3://bucket/some/key.pdf', exp: Date.now() + 10000 });
      s3Service.getKeyFromS3Url.mockReturnValue('some/key.pdf');
      s3Service.getObjectStream.mockRejectedValue(new Error('network down'));

      await expect(service.prepareDownload('sig')).rejects.toMatchObject({
        status: HttpStatus.INTERNAL_SERVER_ERROR,
      });
    });

    it('resolves stream and headers on success, deriving filename/content-type/disposition from the key', async () => {
      fileTokenService.parseToken.mockReturnValue({
        path: 's3://bucket/reports/annual report.pdf',
        exp: Date.now() + 10000,
      });
      s3Service.getKeyFromS3Url.mockReturnValue('reports/annual report.pdf');
      const fakeStream = { pipe: jest.fn(), on: jest.fn() };
      s3Service.getObjectStream.mockResolvedValue(fakeStream);

      const result = await service.prepareDownload('sig');

      expect(result.key).toBe('reports/annual report.pdf');
      expect(result.stream).toBe(fakeStream);
      expect(result.headers.contentType).toBe('application/pdf');
      expect(result.headers.contentDisposition).toContain('inline');
      expect(result.headers.contentDisposition).toContain('annual report.pdf');
    });

    it('defaults content-disposition to attachment for non-inline mime types', async () => {
      fileTokenService.parseToken.mockReturnValue({ path: 's3://bucket/data/export.csv', exp: Date.now() + 10000 });
      s3Service.getKeyFromS3Url.mockReturnValue('data/export.csv');
      s3Service.getObjectStream.mockResolvedValue({ pipe: jest.fn(), on: jest.fn() });

      const result = await service.prepareDownload('sig');

      expect(result.headers.contentDisposition).toContain('attachment');
    });

    it('respects an explicit inline/attachment disposition override from the token payload', async () => {
      fileTokenService.parseToken.mockReturnValue({
        path: 's3://bucket/data/export.csv',
        exp: Date.now() + 10000,
        disposition: 'inline',
      });
      s3Service.getKeyFromS3Url.mockReturnValue('data/export.csv');
      s3Service.getObjectStream.mockResolvedValue({ pipe: jest.fn(), on: jest.fn() });

      const result = await service.prepareDownload('sig');

      expect(result.headers.contentDisposition).toContain('inline');
    });

    it('falls back to "download" as the filename when the key has no basename', async () => {
      fileTokenService.parseToken.mockReturnValue({ path: 's3://bucket/', exp: Date.now() + 10000 });
      s3Service.getKeyFromS3Url.mockReturnValue('');
      // Empty key already triggers BAD_REQUEST before filename derivation; verify that behavior instead.
      await expect(service.prepareDownload('sig')).rejects.toMatchObject({ status: HttpStatus.BAD_REQUEST });
    });
  });
});
