import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { ConfigService } from '@nestjs/config';
import { EmailRemindersService } from './email-reminders.service';
import { EmailQueueService } from 'src/core/queue/email-queue/email-queue.service';
import { User } from 'src/schemas/user/user.schema';
import { EmailTemplate } from 'src/schemas/email-template.schema';
import { EmailReminder, RecipientCategory, ReminderStatus } from 'src/schemas/email-reminder.schema';
import { Role } from 'src/module/auth/enum/role.enum';
import { CreateEmailReminderDto } from './dto/create-email-reminder.dto';

/**
 * Builds a mongoose-query-like mock: awaitable directly (like a real Query,
 * which is thenable) AND supports chained calls (.exec/.populate/.sort/...).
 */
function makeQueryResult<T>(value: T) {
  const query: any = Promise.resolve(value);
  query.exec = jest.fn().mockResolvedValue(value);
  query.populate = jest.fn().mockReturnValue(query);
  query.sort = jest.fn().mockReturnValue(query);
  query.skip = jest.fn().mockReturnValue(query);
  query.limit = jest.fn().mockReturnValue(query);
  query.select = jest.fn().mockReturnValue(query);
  query.lean = jest.fn().mockReturnValue(query);
  return query;
}

describe('EmailRemindersService', () => {
  let service: EmailRemindersService;
  let mockReminderModel: any;
  let mockTemplateModel: any;
  let mockUserModel: any;
  let mockEmailQueue: { addEmailJob: jest.Mock };
  let mockConfig: { get: jest.Mock };

  const activeTemplate = {
    _id: 'tpl1',
    isActive: true,
    subject: 'Hi {{name}}',
    body: '<p>Hello {{name}}</p>',
  };

  const FUTURE_DEADLINE = '2099-06-10';

  beforeEach(async () => {
    mockReminderModel = {
      findOne: jest.fn().mockReturnValue(makeQueryResult(null)),
      find: jest.fn().mockReturnValue(makeQueryResult([])),
      countDocuments: jest.fn().mockResolvedValue(0),
      create: jest.fn(),
      findByIdAndUpdate: jest.fn().mockReturnValue(makeQueryResult(null)),
      findOneAndUpdate: jest.fn().mockReturnValue(makeQueryResult(null)),
    };
    mockTemplateModel = {
      findOne: jest.fn().mockReturnValue(makeQueryResult(activeTemplate)),
      findById: jest.fn().mockReturnValue(makeQueryResult(activeTemplate)),
    };
    mockUserModel = {
      find: jest.fn().mockReturnValue(makeQueryResult([])),
    };
    mockEmailQueue = { addEmailJob: jest.fn().mockResolvedValue(undefined) };
    mockConfig = { get: jest.fn().mockReturnValue(undefined) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EmailRemindersService,
        { provide: getModelToken(EmailReminder.name), useValue: mockReminderModel },
        { provide: getModelToken(EmailTemplate.name), useValue: mockTemplateModel },
        { provide: getModelToken(User.name), useValue: mockUserModel },
        { provide: EmailQueueService, useValue: mockEmailQueue },
        { provide: ConfigService, useValue: mockConfig },
      ],
    }).compile();

    service = module.get<EmailRemindersService>(EmailRemindersService);
  });

  afterEach(() => jest.clearAllMocks());

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  // ─── create ────────────────────────────────────────────────────────────

  describe('create', () => {
    const baseDto: CreateEmailReminderDto = {
      name: 'FY reminder',
      templateId: '665abc123def456789012345',
      deadlineDate: FUTURE_DEADLINE,
      reminderDaysBefore: 1,
      recipientCategory: RecipientCategory.ALL_STATE,
    };

    it('should throw NotFoundException when template does not exist', async () => {
      mockTemplateModel.findOne.mockReturnValue(makeQueryResult(null));

      await expect(service.create(baseDto)).rejects.toThrow(NotFoundException);
    });

    it('should throw BadRequestException when template is inactive', async () => {
      mockTemplateModel.findOne.mockReturnValue(makeQueryResult({ ...activeTemplate, isActive: false }));

      await expect(service.create(baseDto)).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException when computed reminder date is in the past', async () => {
      const pastDto = { ...baseDto, deadlineDate: '2000-01-01', reminderDaysBefore: 1 };

      await expect(service.create(pastDto)).rejects.toThrow(BadRequestException);
    });

    it('should create the reminder with PENDING status when everything is valid', async () => {
      const created = { _id: 'r1', name: baseDto.name };
      mockReminderModel.create.mockResolvedValue(created);

      const result = await service.create(baseDto);

      expect(mockReminderModel.create).toHaveBeenCalledTimes(1);
      const createArg = mockReminderModel.create.mock.calls[0][0];
      expect(createArg.status).toBe(ReminderStatus.PENDING);
      expect(createArg.reminderTime).toBe('09:00');
      expect(result).toEqual(created);
    });

    it('should default variables to an empty object when not provided', async () => {
      mockReminderModel.create.mockResolvedValue({ _id: 'r1' });

      await service.create(baseDto);

      const createArg = mockReminderModel.create.mock.calls[0][0];
      expect(createArg.variables).toEqual({});
    });
  });

  // ─── findAll ───────────────────────────────────────────────────────────

  describe('findAll', () => {
    it('should return paginated results', async () => {
      const docs = [{ _id: 'r1' }, { _id: 'r2' }];
      mockReminderModel.find.mockReturnValue(makeQueryResult(docs));
      mockReminderModel.countDocuments.mockResolvedValue(2);

      const result = await service.findAll(1, 20);

      expect(result).toEqual({ data: docs, total: 2, page: 1, limit: 20, totalPages: 1 });
    });

    it('should apply skip based on page number', async () => {
      const query = makeQueryResult([]);
      mockReminderModel.find.mockReturnValue(query);

      await service.findAll(3, 10);

      expect(query.skip).toHaveBeenCalledWith(20);
      expect(query.limit).toHaveBeenCalledWith(10);
    });
  });

  // ─── findOne ───────────────────────────────────────────────────────────

  describe('findOne', () => {
    it('should return the reminder when found', async () => {
      const reminder = { _id: 'r1', name: 'Test' };
      mockReminderModel.findOne.mockReturnValue(makeQueryResult(reminder));

      const result = await service.findOne('r1');
      expect(result).toEqual(reminder);
    });

    it('should throw NotFoundException when not found', async () => {
      mockReminderModel.findOne.mockReturnValue(makeQueryResult(null));

      await expect(service.findOne('missing')).rejects.toThrow(NotFoundException);
    });
  });

  // ─── update ────────────────────────────────────────────────────────────

  describe('update', () => {
    const existing = {
      _id: 'r1',
      name: 'Existing',
      status: ReminderStatus.PENDING,
      deadlineDate: new Date('2099-06-10'),
      reminderDaysBefore: 5,
      reminderTime: '09:00',
    };

    it('should throw BadRequestException when reminder was already sent', async () => {
      mockReminderModel.findOne.mockReturnValue(makeQueryResult({ ...existing, status: ReminderStatus.SENT }));

      await expect(service.update('r1', { name: 'New name' })).rejects.toThrow(BadRequestException);
    });

    it('should throw NotFoundException when reminder does not exist', async () => {
      mockReminderModel.findOne.mockReturnValue(makeQueryResult(null));

      await expect(service.update('missing', { name: 'New name' })).rejects.toThrow(NotFoundException);
    });

    it('should recalculate reminderDate and reset status to PENDING when deadlineDate changes', async () => {
      mockReminderModel.findOne.mockReturnValue(makeQueryResult(existing));
      const updated = { ...existing, name: 'Existing', reminderDate: new Date() };
      mockReminderModel.findByIdAndUpdate.mockReturnValue(makeQueryResult(updated));

      await service.update('r1', { deadlineDate: '2099-07-20' });

      const [, updatePayload] = mockReminderModel.findByIdAndUpdate.mock.calls[0];
      expect(updatePayload.$set.status).toBe(ReminderStatus.PENDING);
      expect(updatePayload.$set.sentAt).toBeNull();
    });

    it('should throw BadRequestException when recalculated date falls in the past', async () => {
      mockReminderModel.findOne.mockReturnValue(makeQueryResult(existing));

      await expect(service.update('r1', { deadlineDate: '2000-01-01' })).rejects.toThrow(BadRequestException);
    });

    it('should throw NotFoundException when updated templateId does not exist', async () => {
      mockReminderModel.findOne.mockReturnValue(makeQueryResult(existing));
      mockTemplateModel.findOne.mockReturnValue(makeQueryResult(null));

      await expect(service.update('r1', { templateId: 'missing-tpl' })).rejects.toThrow(NotFoundException);
    });

    it('should return the updated reminder on success', async () => {
      mockReminderModel.findOne.mockReturnValue(makeQueryResult(existing));
      const updated = { ...existing, name: 'Renamed', reminderDate: new Date('2099-07-19T03:30:00Z') };
      mockReminderModel.findByIdAndUpdate.mockReturnValue(makeQueryResult(updated));

      const result = await service.update('r1', { name: 'Renamed' });

      expect(result).toEqual(updated);
    });

    it('should throw NotFoundException when findByIdAndUpdate returns null', async () => {
      mockReminderModel.findOne.mockReturnValue(makeQueryResult(existing));
      mockReminderModel.findByIdAndUpdate.mockReturnValue(makeQueryResult(null));

      await expect(service.update('r1', { name: 'Renamed' })).rejects.toThrow(NotFoundException);
    });
  });

  // ─── cancel ────────────────────────────────────────────────────────────

  describe('cancel', () => {
    it('should soft-delete and return confirmation message', async () => {
      mockReminderModel.findOneAndUpdate.mockReturnValue(makeQueryResult({ _id: 'r1', name: 'Test' }));

      const result = await service.cancel('r1');

      expect(result.message).toContain('Test');
      expect(result.message).toContain('cancelled');
    });

    it('should throw NotFoundException when reminder does not exist', async () => {
      mockReminderModel.findOneAndUpdate.mockReturnValue(makeQueryResult(null));

      await expect(service.cancel('missing')).rejects.toThrow(NotFoundException);
    });
  });

  // ─── triggerNow / dispatch ─────────────────────────────────────────────

  describe('triggerNow', () => {
    const reminder = {
      _id: 'r1',
      id: 'r1',
      name: 'Test reminder',
      templateId: 'tpl1',
      recipientCategory: RecipientCategory.ALL_ULB,
      variables: { fy: '2026-27' },
    };

    it('should throw NotFoundException when reminder does not exist', async () => {
      mockReminderModel.findOne.mockReturnValue(makeQueryResult(null));

      await expect(service.triggerNow('missing')).rejects.toThrow(NotFoundException);
    });

    it('should mark reminder as failed and queue nothing when template is missing or inactive', async () => {
      mockReminderModel.findOne.mockReturnValue(makeQueryResult(reminder));
      mockTemplateModel.findById.mockReturnValue(makeQueryResult(null));

      const result = await service.triggerNow('r1');

      expect(result).toEqual({ reminderId: 'r1', name: 'Test reminder', recipientCount: 0, queued: 0 });
      expect(mockReminderModel.findByIdAndUpdate).toHaveBeenCalledWith(
        'r1',
        expect.objectContaining({ $set: expect.objectContaining({ status: ReminderStatus.FAILED }) }),
      );
      expect(mockEmailQueue.addEmailJob).not.toHaveBeenCalled();
    });

    it('should mark reminder as sent with zero count when there are no recipients', async () => {
      mockReminderModel.findOne.mockReturnValue(makeQueryResult(reminder));
      mockTemplateModel.findById.mockReturnValue(makeQueryResult(activeTemplate));
      mockUserModel.find.mockReturnValue(makeQueryResult([]));

      const result = await service.triggerNow('r1');

      expect(result).toEqual({ reminderId: 'r1', name: 'Test reminder', recipientCount: 0, queued: 0 });
      expect(mockReminderModel.findByIdAndUpdate).toHaveBeenCalledWith(
        'r1',
        expect.objectContaining({ $set: expect.objectContaining({ status: ReminderStatus.SENT, sentCount: 0 }) }),
      );
    });

    it('should queue an email per resolved recipient and mark as sent', async () => {
      mockReminderModel.findOne.mockReturnValue(makeQueryResult(reminder));
      mockTemplateModel.findById.mockReturnValue(makeQueryResult(activeTemplate));
      mockUserModel.find.mockReturnValue(
        makeQueryResult([
          { name: 'Alice', email: 'Alice@Example.com' },
          { name: 'Bob', email: 'bob@example.com' },
        ]),
      );

      const result = await service.triggerNow('r1');

      expect(mockEmailQueue.addEmailJob).toHaveBeenCalledTimes(2);
      expect(mockEmailQueue.addEmailJob).toHaveBeenCalledWith(
        expect.objectContaining({ to: 'alice@example.com' }),
      );
      expect(result).toEqual({ reminderId: 'r1', name: 'Test reminder', recipientCount: 2, queued: 2 });
    });
  });

  // ─── previewRecipients (exercises resolveRecipients) ──────────────────

  describe('previewRecipients', () => {
    it('should return the TEST_RECIPIENT_EMAIL for ONLY_ME when configured', async () => {
      mockConfig.get.mockReturnValue('Test@Example.com');

      const result = await service.previewRecipients(RecipientCategory.ONLY_ME);

      expect(result).toEqual({ category: RecipientCategory.ONLY_ME, count: 1, emails: ['test@example.com'] });
    });

    it('should return no recipients for ONLY_ME when TEST_RECIPIENT_EMAIL is not set', async () => {
      mockConfig.get.mockReturnValue(undefined);

      const result = await service.previewRecipients(RecipientCategory.ONLY_ME);

      expect(result).toEqual({ category: RecipientCategory.ONLY_ME, count: 0, emails: [] });
    });

    it('should filter users by role for a role-scoped category', async () => {
      mockUserModel.find.mockReturnValue(makeQueryResult([{ name: 'Ulb User', email: 'ulb@example.com' }]));

      await service.previewRecipients(RecipientCategory.ALL_ULB);

      const filterArg = mockUserModel.find.mock.calls[0][0];
      expect(filterArg.role).toEqual({ $in: [Role.ULB] });
    });

    it('should not filter by role for ALL_USERS', async () => {
      mockUserModel.find.mockReturnValue(makeQueryResult([]));

      await service.previewRecipients(RecipientCategory.ALL_USERS);

      const filterArg = mockUserModel.find.mock.calls[0][0];
      expect(filterArg.role).toBeUndefined();
    });

    it('should de-duplicate recipients by lower-cased email', async () => {
      mockUserModel.find.mockReturnValue(
        makeQueryResult([
          { name: 'A', email: 'dup@example.com' },
          { name: 'B', email: 'DUP@example.com' },
        ]),
      );

      const result = await service.previewRecipients(RecipientCategory.ALL_USERS);

      expect(result.count).toBe(1);
      expect(result.emails).toEqual(['dup@example.com']);
    });

    it('should skip users with a missing email', async () => {
      mockUserModel.find.mockReturnValue(makeQueryResult([{ name: 'No Email', email: undefined }]));

      const result = await service.previewRecipients(RecipientCategory.ALL_USERS);

      expect(result.count).toBe(0);
    });
  });

  // ─── handleDailyCron ───────────────────────────────────────────────────

  describe('handleDailyCron', () => {
    it('should do nothing when no reminders are due', async () => {
      mockReminderModel.find.mockReturnValue(makeQueryResult([]));

      await service.handleDailyCron();

      expect(mockEmailQueue.addEmailJob).not.toHaveBeenCalled();
    });

    it('should dispatch every due reminder', async () => {
      const due = [
        { _id: 'r1', id: 'r1', name: 'R1', templateId: 'tpl1', recipientCategory: RecipientCategory.ALL_ULB, variables: {} },
        { _id: 'r2', id: 'r2', name: 'R2', templateId: 'tpl1', recipientCategory: RecipientCategory.ALL_ULB, variables: {} },
      ];
      mockReminderModel.find.mockReturnValue(makeQueryResult(due));
      mockTemplateModel.findById.mockReturnValue(makeQueryResult(activeTemplate));
      mockUserModel.find.mockReturnValue(makeQueryResult([]));

      await service.handleDailyCron();

      expect(mockReminderModel.findByIdAndUpdate).toHaveBeenCalledTimes(2);
    });
  });
});
