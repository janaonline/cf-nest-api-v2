import { Test, TestingModule } from '@nestjs/testing';
import { EmailTemplatesController } from './email-templates.controller';
import { EmailTemplatesService } from './email-templates.service';
import { WeeklyReportService } from './weekly-report.service';
import { CreateEmailTemplateDto } from './dto/create-email-template.dto';
import { UpdateEmailTemplateDto } from './dto/update-email-template.dto';
import { SendTemplateEmailDto } from './dto/send-template-email.dto';

describe('EmailTemplatesController', () => {
  let controller: EmailTemplatesController;
  let service: jest.Mocked<EmailTemplatesService>;
  let weeklyReport: jest.Mocked<WeeklyReportService>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [EmailTemplatesController],
      providers: [
        {
          provide: EmailTemplatesService,
          useValue: {
            create: jest.fn(),
            findAll: jest.fn(),
            findBySlug: jest.fn(),
            findOne: jest.fn(),
            update: jest.fn(),
            remove: jest.fn(),
            send: jest.fn(),
          },
        },
        {
          provide: WeeklyReportService,
          useValue: {
            seedWeeklyReportTemplate: jest.fn(),
            sendWeeklyReport: jest.fn(),
          },
        },
      ],
    }).compile();

    controller = module.get<EmailTemplatesController>(EmailTemplatesController);
    service = module.get(EmailTemplatesService);
    weeklyReport = module.get(WeeklyReportService);
  });

  afterEach(() => jest.clearAllMocks());

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('create', () => {
    it('should delegate to service.create', async () => {
      const dto: CreateEmailTemplateDto = {
        name: 'Pending Review',
        subject: 'Your submission is pending review',
        body: '<p>Dear {{name}}</p>',
      };
      const created = { _id: 't1', ...dto, slug: 'pending-review' };
      service.create.mockResolvedValue(created as never);

      const result = await controller.create(dto);

      expect(service.create).toHaveBeenCalledWith(dto);
      expect(result).toEqual(created);
    });

    it('should propagate ConflictException from service.create', async () => {
      const dto = { name: 'Dup', subject: 's', body: 'b' } as CreateEmailTemplateDto;
      service.create.mockRejectedValue(new Error('A template with slug "dup" already exists'));

      await expect(controller.create(dto)).rejects.toThrow('already exists');
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

  describe('findBySlug', () => {
    it('should delegate to service.findBySlug', async () => {
      const tpl = { _id: 't1', slug: 'pending-review' };
      service.findBySlug.mockResolvedValue(tpl as never);

      const result = await controller.findBySlug('pending-review');

      expect(service.findBySlug).toHaveBeenCalledWith('pending-review');
      expect(result).toEqual(tpl);
    });
  });

  describe('findOne', () => {
    it('should delegate to service.findOne', async () => {
      const tpl = { _id: 't1' };
      service.findOne.mockResolvedValue(tpl as never);

      const result = await controller.findOne('t1');

      expect(service.findOne).toHaveBeenCalledWith('t1');
      expect(result).toEqual(tpl);
    });

    it('should propagate NotFoundException from service.findOne', async () => {
      service.findOne.mockRejectedValue(new Error('Email template not found'));

      await expect(controller.findOne('missing')).rejects.toThrow('Email template not found');
    });
  });

  describe('update', () => {
    it('should delegate to service.update', async () => {
      const dto: UpdateEmailTemplateDto = { name: 'Renamed' };
      const updated = { _id: 't1', name: 'Renamed' };
      service.update.mockResolvedValue(updated as never);

      const result = await controller.update('t1', dto);

      expect(service.update).toHaveBeenCalledWith('t1', dto);
      expect(result).toEqual(updated);
    });
  });

  describe('remove', () => {
    it('should delegate to service.remove', async () => {
      const message = { message: 'Template "X" deleted successfully' };
      service.remove.mockResolvedValue(message);

      const result = await controller.remove('t1');

      expect(service.remove).toHaveBeenCalledWith('t1');
      expect(result).toEqual(message);
    });
  });

  describe('send', () => {
    it('should delegate to service.send', async () => {
      const dto: SendTemplateEmailDto = { to: ['a@example.com'], subject: 'Hi', body: '<p>Hi</p>' };
      const sent = { message: '1 email(s) queued for delivery', queued: 1 };
      service.send.mockResolvedValue(sent);

      const result = await controller.send(dto);

      expect(service.send).toHaveBeenCalledWith(dto);
      expect(result).toEqual(sent);
    });
  });

  describe('seedWeeklyTemplate', () => {
    it('should delegate to weeklyReport.seedWeeklyReportTemplate', async () => {
      const seeded = { created: true, message: 'Weekly report template created successfully' };
      weeklyReport.seedWeeklyReportTemplate.mockResolvedValue(seeded);

      const result = await controller.seedWeeklyTemplate();

      expect(weeklyReport.seedWeeklyReportTemplate).toHaveBeenCalledTimes(1);
      expect(result).toEqual(seeded);
    });
  });

  describe('sendWeeklyReport', () => {
    it('should delegate to weeklyReport.sendWeeklyReport', async () => {
      const sent = { queued: 5, total: 5 };
      weeklyReport.sendWeeklyReport.mockResolvedValue(sent);

      const result = await controller.sendWeeklyReport();

      expect(weeklyReport.sendWeeklyReport).toHaveBeenCalledTimes(1);
      expect(result).toEqual(sent);
    });

    it('should propagate NotFoundException when the weekly template is missing', async () => {
      weeklyReport.sendWeeklyReport.mockRejectedValue(new Error('Weekly report template not found'));

      await expect(controller.sendWeeklyReport()).rejects.toThrow('Weekly report template not found');
    });
  });
});
