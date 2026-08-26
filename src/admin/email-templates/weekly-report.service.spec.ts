import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { WeeklyReportService } from './weekly-report.service';
import { EmailQueueService } from 'src/core/queue/email-queue/email-queue.service';
import { User } from 'src/schemas/user/user.schema';
import { EmailTemplate } from 'src/schemas/email-template.schema';

function makeQueryResult<T>(value: T) {
  const query: any = Promise.resolve(value);
  query.exec = jest.fn().mockResolvedValue(value);
  query.select = jest.fn().mockReturnValue(query);
  query.lean = jest.fn().mockReturnValue(query);
  return query;
}

describe('WeeklyReportService', () => {
  let service: WeeklyReportService;
  let mockUserModel: any;
  let mockTemplateModel: any;
  let mockEmailQueue: { addEmailJob: jest.Mock };

  const weeklyTemplate = {
    slug: 'weekly-report',
    isActive: true,
    subject: '{{stateName}} — Status Update for the week — {{date}}',
    body: '<p>Hello {{name}}, total ULBs {{totalUlbs}}</p>',
  };

  beforeEach(async () => {
    mockUserModel = { find: jest.fn().mockReturnValue(makeQueryResult([])) };
    mockTemplateModel = {
      findOne: jest.fn().mockReturnValue(makeQueryResult(null)),
      create: jest.fn(),
    };
    mockEmailQueue = { addEmailJob: jest.fn().mockResolvedValue(undefined) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WeeklyReportService,
        { provide: getModelToken(User.name), useValue: mockUserModel },
        { provide: getModelToken(EmailTemplate.name), useValue: mockTemplateModel },
        { provide: EmailQueueService, useValue: mockEmailQueue },
      ],
    }).compile();

    service = module.get<WeeklyReportService>(WeeklyReportService);
  });

  afterEach(() => jest.clearAllMocks());

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  // ─── sendWeeklyReport ──────────────────────────────────────────────────

  describe('sendWeeklyReport', () => {
    it('should throw NotFoundException when the weekly-report template does not exist', async () => {
      mockTemplateModel.findOne.mockReturnValue(makeQueryResult(null));

      await expect(service.sendWeeklyReport()).rejects.toThrow(NotFoundException);
      expect(mockTemplateModel.findOne).toHaveBeenCalledWith({
        slug: 'weekly-report',
        isDeleted: false,
        isActive: true,
      });
    });

    it('should return zero counts when there are no users with a valid email', async () => {
      mockTemplateModel.findOne.mockReturnValue(makeQueryResult(weeklyTemplate));
      mockUserModel.find.mockReturnValue(makeQueryResult([]));

      const result = await service.sendWeeklyReport();

      expect(result).toEqual({ queued: 0, total: 0 });
      expect(mockEmailQueue.addEmailJob).not.toHaveBeenCalled();
    });

    it('should queue one email per unique user and return counts', async () => {
      mockTemplateModel.findOne.mockReturnValue(makeQueryResult(weeklyTemplate));
      mockUserModel.find.mockReturnValue(
        makeQueryResult([
          { name: 'Alice', email: 'alice@example.com' },
          { name: 'Bob', email: 'bob@example.com' },
        ]),
      );

      const result = await service.sendWeeklyReport();

      expect(mockEmailQueue.addEmailJob).toHaveBeenCalledTimes(2);
      expect(result).toEqual({ queued: 2, total: 2 });
    });

    it('should de-duplicate users by lower-cased email', async () => {
      mockTemplateModel.findOne.mockReturnValue(makeQueryResult(weeklyTemplate));
      mockUserModel.find.mockReturnValue(
        makeQueryResult([
          { name: 'Alice', email: 'dup@example.com' },
          { name: 'Alice2', email: 'DUP@example.com' },
        ]),
      );

      const result = await service.sendWeeklyReport();

      expect(result).toEqual({ queued: 1, total: 1 });
    });

    it('should default missing user name to "User" in interpolated variables', async () => {
      mockTemplateModel.findOne.mockReturnValue(makeQueryResult(weeklyTemplate));
      mockUserModel.find.mockReturnValue(makeQueryResult([{ name: undefined, email: 'noname@example.com' }]));

      await service.sendWeeklyReport();

      expect(mockEmailQueue.addEmailJob).toHaveBeenCalledWith(
        expect.objectContaining({ html: expect.stringContaining('Hello User') }),
      );
    });

    it('should fill in placeholder stats (currently all zero) in the interpolated body', async () => {
      mockTemplateModel.findOne.mockReturnValue(makeQueryResult(weeklyTemplate));
      mockUserModel.find.mockReturnValue(makeQueryResult([{ name: 'Alice', email: 'alice@example.com' }]));

      await service.sendWeeklyReport();

      expect(mockEmailQueue.addEmailJob).toHaveBeenCalledWith(
        expect.objectContaining({ html: expect.stringContaining('total ULBs 0') }),
      );
    });
  });

  // ─── seedWeeklyReportTemplate ──────────────────────────────────────────

  describe('seedWeeklyReportTemplate', () => {
    it('should report already-exists without creating a duplicate', async () => {
      mockTemplateModel.findOne.mockReturnValue(makeQueryResult({ slug: 'weekly-report' }));

      const result = await service.seedWeeklyReportTemplate();

      expect(result).toEqual({ created: false, message: 'Weekly report template already exists' });
      expect(mockTemplateModel.create).not.toHaveBeenCalled();
    });

    it('should create the default template when missing', async () => {
      mockTemplateModel.findOne.mockReturnValue(makeQueryResult(null));
      mockTemplateModel.create.mockResolvedValue({ slug: 'weekly-report' });

      const result = await service.seedWeeklyReportTemplate();

      expect(mockTemplateModel.create).toHaveBeenCalledTimes(1);
      const createArg = mockTemplateModel.create.mock.calls[0][0];
      expect(createArg.slug).toBe('weekly-report');
      expect(createArg.isActive).toBe(true);
      expect(result).toEqual({ created: true, message: 'Weekly report template created successfully' });
    });
  });
});
