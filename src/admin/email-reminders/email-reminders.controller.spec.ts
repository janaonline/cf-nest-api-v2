import { Test, TestingModule } from '@nestjs/testing';
import { EmailRemindersController } from './email-reminders.controller';
import { EmailRemindersService } from './email-reminders.service';
import { RecipientCategory } from 'src/schemas/email-reminder.schema';
import { CreateEmailReminderDto } from './dto/create-email-reminder.dto';
import { UpdateEmailReminderDto } from './dto/update-email-reminder.dto';

describe('EmailRemindersController', () => {
  let controller: EmailRemindersController;
  let service: jest.Mocked<EmailRemindersService>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [EmailRemindersController],
      providers: [
        {
          provide: EmailRemindersService,
          useValue: {
            create: jest.fn(),
            findAll: jest.fn(),
            previewRecipients: jest.fn(),
            findOne: jest.fn(),
            update: jest.fn(),
            cancel: jest.fn(),
            triggerNow: jest.fn(),
          },
        },
      ],
    }).compile();

    controller = module.get<EmailRemindersController>(EmailRemindersController);
    service = module.get(EmailRemindersService);
  });

  afterEach(() => jest.clearAllMocks());

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('create', () => {
    it('should delegate to service.create', async () => {
      const dto: CreateEmailReminderDto = {
        name: 'Deadline reminder',
        templateId: '665abc123def456789012345',
        deadlineDate: '2026-06-10',
        reminderDaysBefore: 5,
        recipientCategory: RecipientCategory.ALL_STATE,
      };
      const created = { _id: 'r1', ...dto };
      service.create.mockResolvedValue(created as never);

      const result = await controller.create(dto);

      expect(service.create).toHaveBeenCalledWith(dto);
      expect(result).toEqual(created);
    });

    it('should propagate errors from service.create', async () => {
      const dto = {} as CreateEmailReminderDto;
      service.create.mockRejectedValue(new Error('Reminder date is in the past'));

      await expect(controller.create(dto)).rejects.toThrow('Reminder date is in the past');
    });
  });

  describe('findAll', () => {
    it('should delegate to service.findAll with pagination', async () => {
      const paginated = { data: [], total: 0, page: 1, limit: 20, totalPages: 0 };
      service.findAll.mockResolvedValue(paginated as never);

      const result = await controller.findAll({ page: 1, limit: 20 });

      expect(service.findAll).toHaveBeenCalledWith(1, 20);
      expect(result).toEqual(paginated);
    });
  });

  describe('previewRecipients', () => {
    it('should delegate to service.previewRecipients', async () => {
      const preview = { category: RecipientCategory.ALL_ULB, count: 2, emails: ['a@x.com', 'b@x.com'] };
      service.previewRecipients.mockResolvedValue(preview);

      const result = await controller.previewRecipients(RecipientCategory.ALL_ULB);

      expect(service.previewRecipients).toHaveBeenCalledWith(RecipientCategory.ALL_ULB);
      expect(result).toEqual(preview);
    });
  });

  describe('findOne', () => {
    it('should delegate to service.findOne', async () => {
      const reminder = { _id: 'r1', name: 'Test' };
      service.findOne.mockResolvedValue(reminder as never);

      const result = await controller.findOne('r1');

      expect(service.findOne).toHaveBeenCalledWith('r1');
      expect(result).toEqual(reminder);
    });

    it('should propagate NotFoundException from service.findOne', async () => {
      service.findOne.mockRejectedValue(new Error('Email reminder not found'));

      await expect(controller.findOne('missing')).rejects.toThrow('Email reminder not found');
    });
  });

  describe('update', () => {
    it('should delegate to service.update', async () => {
      const dto: UpdateEmailReminderDto = { name: 'Updated name' };
      const updated = { _id: 'r1', name: 'Updated name' };
      service.update.mockResolvedValue(updated as never);

      const result = await controller.update('r1', dto);

      expect(service.update).toHaveBeenCalledWith('r1', dto);
      expect(result).toEqual(updated);
    });
  });

  describe('cancel', () => {
    it('should delegate to service.cancel', async () => {
      const message = { message: 'Reminder "Test" has been cancelled' };
      service.cancel.mockResolvedValue(message);

      const result = await controller.cancel('r1');

      expect(service.cancel).toHaveBeenCalledWith('r1');
      expect(result).toEqual(message);
    });
  });

  describe('triggerNow', () => {
    it('should delegate to service.triggerNow', async () => {
      const dispatch = { reminderId: 'r1', name: 'Test', recipientCount: 3, queued: 3 };
      service.triggerNow.mockResolvedValue(dispatch);

      const result = await controller.triggerNow('r1');

      expect(service.triggerNow).toHaveBeenCalledWith('r1');
      expect(result).toEqual(dispatch);
    });
  });
});
