import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { ZipBuildService } from './zip-build.service';
import { S3Service } from 'src/core/s3/s3.service';
import { EmailService } from 'src/core/email/email.service';
import { NodeMailerService } from 'src/core/node-mailer/node-mailer.service';
import { ULBData } from './zip.types';

const mockArchiveInstance: any = {
  pipe: jest.fn(),
  append: jest.fn(),
  on: jest.fn(),
  finalize: jest.fn().mockResolvedValue(undefined),
};

jest.mock('archiver', () => jest.fn(() => mockArchiveInstance));

const mockUploadDone = jest.fn();
const UploadMock = jest.fn().mockImplementation(() => ({ done: mockUploadDone }));

jest.mock('@aws-sdk/lib-storage', () => ({
  Upload: jest.fn().mockImplementation((...args) => UploadMock(...args)),
}));

describe('ZipBuildService', () => {
  let service: ZipBuildService;
  let s3svc: { bucket: string; client: object; headObject: jest.Mock; getObjectStream: jest.Mock };
  let emailService: { generateToken: jest.Mock };
  let mailer: { sendEmailWithTemplate: jest.Mock };

  const makeUlbData = (): ULBData[] => [
    {
      _id: 'ulb-1',
      state: 'state-1',
      ulbId: 'ulb-1',
      ulbName: 'Test ULB',
      stateName: 'Test State',
      auditType: 'audited',
      year: '2021-22',
      files: [{ name: 'balance-sheet', url: '/folder/balance-sheet.pdf' }],
    },
  ];

  beforeEach(async () => {
    jest.clearAllMocks();
    mockArchiveInstance.finalize.mockResolvedValue(undefined);
    mockUploadDone.mockResolvedValue({});

    s3svc = {
      bucket: 'test-bucket',
      client: {},
      headObject: jest.fn().mockResolvedValue({}),
      getObjectStream: jest.fn().mockResolvedValue('fake-readable-stream'),
    };

    emailService = { generateToken: jest.fn().mockReturnValue('signed-token') };
    mailer = { sendEmailWithTemplate: jest.fn().mockResolvedValue(undefined) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ZipBuildService,
        { provide: S3Service, useValue: s3svc },
        {
          provide: ConfigService,
          useValue: { get: jest.fn().mockReturnValue('https://cityfinance.example.com/') },
        },
        { provide: EmailService, useValue: emailService },
        { provide: NodeMailerService, useValue: mailer },
      ],
    }).compile();

    service = module.get<ZipBuildService>(ZipBuildService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('buildZipToS3', () => {
    it('should stream all files into the archive and complete the multipart upload', async () => {
      const result = await service.buildZipToS3({
        ulbData: makeUlbData(),
        outputKey: 'zips/output.zip',
        downloadType: 'Raw Data PDF',
      });

      expect(s3svc.headObject).toHaveBeenCalledWith('folder/balance-sheet.pdf');
      expect(s3svc.getObjectStream).toHaveBeenCalledWith('folder/balance-sheet.pdf');
      expect(mockArchiveInstance.append).toHaveBeenCalledWith('fake-readable-stream', expect.objectContaining({}));
      expect(mockArchiveInstance.finalize).toHaveBeenCalled();
      expect(mockUploadDone).toHaveBeenCalled();
      expect(result).toEqual({
        bucket: 'test-bucket',
        zipKey: 'zips/output.zip',
        totalFiles: 1,
        skippedFiles: 0,
      });
    });

    it('should skip files that fail the S3 existence check and continue processing', async () => {
      const ulbData = makeUlbData();
      ulbData[0].files.push({ name: 'audit-report', url: '/folder/audit-report.pdf' });
      s3svc.headObject.mockResolvedValueOnce({}).mockRejectedValueOnce(new Error('NotFound'));

      const result = await service.buildZipToS3({
        ulbData,
        outputKey: 'zips/output.zip',
        downloadType: 'Raw Data PDF',
      });

      expect(result.totalFiles).toBe(1);
      expect(result.skippedFiles).toBe(1);
    });

    it('should throw and log when the archive fails to finalize', async () => {
      mockArchiveInstance.finalize.mockRejectedValueOnce(new Error('archive finalize failed'));

      await expect(
        service.buildZipToS3({
          ulbData: makeUlbData(),
          outputKey: 'zips/output.zip',
          downloadType: 'Raw Data PDF',
        }),
      ).rejects.toThrow('archive finalize failed');
    });

    it('should throw when the multipart upload fails', async () => {
      mockUploadDone.mockRejectedValueOnce(new Error('upload failed'));

      await expect(
        service.buildZipToS3({
          ulbData: makeUlbData(),
          outputKey: 'zips/output.zip',
          downloadType: 'Raw Data PDF',
        }),
      ).rejects.toThrow('upload failed');
    });

    it('should re-throw synchronously from the archiver "error" event handler', async () => {
      await service.buildZipToS3({
        ulbData: makeUlbData(),
        outputKey: 'zips/output.zip',
        downloadType: 'Raw Data PDF',
      });

      const errorHandlerCall = mockArchiveInstance.on.mock.calls.find(([event]: [string]) => event === 'error');
      expect(errorHandlerCall).toBeDefined();
      const handler = errorHandlerCall![1] as (err: Error) => void;

      expect(() => handler(new Error('archiver internal error'))).toThrow('archiver internal error');
    });
  });

  describe('cleanUrl', () => {
    it('should strip a single leading slash', () => {
      expect(service.cleanUrl('/folder/file.pdf')).toBe('folder/file.pdf');
    });

    it('should leave paths without a leading slash untouched', () => {
      expect(service.cleanUrl('folder/file.pdf')).toBe('folder/file.pdf');
    });

    it('should decode percent-encoded characters', () => {
      expect(service.cleanUrl('/folder/file%20name.pdf')).toBe('folder/file name.pdf');
    });
  });

  describe('sendDownloadLink', () => {
    it('should send the download link email when ULB data is present', async () => {
      const ulbData = makeUlbData();

      await service.sendDownloadLink({
        to: 'user@example.com',
        subject: 'Your City Finance Data is Ready to Download',
        link: 'https://example.com/download.zip',
        ulbData,
        downloadType: 'Raw Data PDF',
      });

      expect(emailService.generateToken).toHaveBeenCalledWith({
        email: 'user@example.com',
        desc: 'Your City Finance Data is Ready to Download',
      });
      expect(mailer.sendEmailWithTemplate).toHaveBeenCalledWith(
        'user@example.com',
        'Your City Finance Data is Ready to Download',
        'resource-zip-ready',
        expect.objectContaining({
          name: 'user',
          download_link: 'https://example.com/download.zip',
          state: 'Test State',
          year: '2021-22',
          ulbs: 'Test ULB',
          downloadType: 'Raw Data PDF',
        }),
      );
    });

    it('should skip sending email when ULB data is empty', async () => {
      await service.sendDownloadLink({
        to: 'user@example.com',
        subject: 'subject',
        link: 'https://example.com/download.zip',
        ulbData: [],
        downloadType: 'Raw Data PDF',
      });

      expect(mailer.sendEmailWithTemplate).not.toHaveBeenCalled();
    });

    it('should swallow errors thrown while sending the email', async () => {
      mailer.sendEmailWithTemplate.mockRejectedValueOnce(new Error('SMTP down'));

      await expect(
        service.sendDownloadLink({
          to: 'user@example.com',
          subject: 'subject',
          link: 'https://example.com/download.zip',
          ulbData: makeUlbData(),
          downloadType: 'Raw Data PDF',
        }),
      ).resolves.toBeUndefined();
    });
  });
});
