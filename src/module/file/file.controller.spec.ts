import { Test, TestingModule } from '@nestjs/testing';
import { HttpStatus } from '@nestjs/common';
import type { Response } from 'express';
import { FileController } from './file.controller';
import { FileService } from './file.service';

/** Minimal Readable-stream stand-in that records the registered 'error' handler for manual triggering. */
function createMockStream() {
  const handlers: Record<string, ((err: unknown) => void)[]> = {};
  return {
    on: jest.fn((event: string, cb: (err: unknown) => void) => {
      (handlers[event] ??= []).push(cb);
    }),
    pipe: jest.fn(),
    destroy: jest.fn(),
    emitError(err: unknown) {
      handlers['error']?.forEach((cb) => cb(err));
    },
  };
}

function createMockResponse(): Partial<Response> & {
  setHeader: jest.Mock;
  status: jest.Mock;
  json: jest.Mock;
  destroy: jest.Mock;
  headersSent: boolean;
} {
  const res: any = {
    headersSent: false,
    setHeader: jest.fn(),
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
    destroy: jest.fn(),
  };
  return res;
}

describe('FileController', () => {
  let controller: FileController;
  let fileService: { prepareDownload: jest.Mock };

  beforeEach(async () => {
    fileService = { prepareDownload: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [FileController],
      providers: [{ provide: FileService, useValue: fileService }],
    }).compile();

    controller = module.get<FileController>(FileController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('sets response headers from the prepared download and pipes the stream', async () => {
    const stream = createMockStream();
    fileService.prepareDownload.mockResolvedValue({
      key: 'reports/file.pdf',
      stream,
      headers: { contentType: 'application/pdf', contentDisposition: 'inline; filename="file.pdf"' },
    });
    const res = createMockResponse();

    await controller.download('sig', res as unknown as Response);

    expect(fileService.prepareDownload).toHaveBeenCalledWith('sig');
    expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'application/pdf');
    expect(res.setHeader).toHaveBeenCalledWith('Content-Disposition', 'inline; filename="file.pdf"');
    expect(res.setHeader).toHaveBeenCalledWith('X-Content-Type-Options', 'nosniff');
    expect(res.setHeader).toHaveBeenCalledWith('Cache-Control', 'no-store');
    expect(stream.pipe).toHaveBeenCalledWith(res);
  });

  it('responds 404 on a stream error caused by a missing S3 object, when headers were not yet sent', async () => {
    const stream = createMockStream();
    fileService.prepareDownload.mockResolvedValue({
      key: 'reports/missing.pdf',
      stream,
      headers: { contentType: 'application/pdf', contentDisposition: 'inline; filename="missing.pdf"' },
    });
    const res = createMockResponse();

    await controller.download('sig', res as unknown as Response);
    stream.emitError({ name: 'NoSuchKey' });

    expect(res.status).toHaveBeenCalledWith(HttpStatus.NOT_FOUND);
    expect(res.json).toHaveBeenCalledWith({ success: false, message: 'File not found' });
  });

  it('responds 500 on a generic stream error, when headers were not yet sent', async () => {
    const stream = createMockStream();
    fileService.prepareDownload.mockResolvedValue({
      key: 'reports/file.pdf',
      stream,
      headers: { contentType: 'application/pdf', contentDisposition: 'inline; filename="file.pdf"' },
    });
    const res = createMockResponse();

    await controller.download('sig', res as unknown as Response);
    stream.emitError(new Error('S3 hiccup'));

    expect(res.status).toHaveBeenCalledWith(HttpStatus.INTERNAL_SERVER_ERROR);
    expect(res.json).toHaveBeenCalledWith({ success: false, message: 'Failed to stream file' });
  });

  it('destroys the response instead of writing a JSON body when headers were already sent', async () => {
    const stream = createMockStream();
    fileService.prepareDownload.mockResolvedValue({
      key: 'reports/file.pdf',
      stream,
      headers: { contentType: 'application/pdf', contentDisposition: 'inline; filename="file.pdf"' },
    });
    const res = createMockResponse();
    res.headersSent = true;

    await controller.download('sig', res as unknown as Response);
    stream.emitError(new Error('mid-stream failure'));

    expect(res.destroy).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
    expect(res.json).not.toHaveBeenCalled();
  });
});
