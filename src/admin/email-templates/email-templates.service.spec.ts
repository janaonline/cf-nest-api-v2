import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { EmailTemplatesService } from './email-templates.service';
import { EmailQueueService } from 'src/core/queue/email-queue/email-queue.service';
import { EmailTemplate } from 'src/schemas/email-template.schema';
import { CreateEmailTemplateDto } from './dto/create-email-template.dto';
import { SendTemplateEmailDto } from './dto/send-template-email.dto';

function makeQueryResult<T>(value: T) {
  const query: any = Promise.resolve(value);
  query.exec = jest.fn().mockResolvedValue(value);
  query.sort = jest.fn().mockReturnValue(query);
  query.skip = jest.fn().mockReturnValue(query);
  query.limit = jest.fn().mockReturnValue(query);
  return query;
}

describe('EmailTemplatesService', () => {
  let service: EmailTemplatesService;
  let mockTemplateModel: any;
  let mockEmailQueue: { addEmailJob: jest.Mock };

  beforeEach(async () => {
    mockTemplateModel = {
      findOne: jest.fn().mockReturnValue(makeQueryResult(null)),
      find: jest.fn().mockReturnValue(makeQueryResult([])),
      countDocuments: jest.fn().mockResolvedValue(0),
      create: jest.fn(),
      findOneAndUpdate: jest.fn().mockReturnValue(makeQueryResult(null)),
    };
    mockEmailQueue = { addEmailJob: jest.fn().mockResolvedValue(undefined) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EmailTemplatesService,
        { provide: getModelToken(EmailTemplate.name), useValue: mockTemplateModel },
        { provide: EmailQueueService, useValue: mockEmailQueue },
      ],
    }).compile();

    service = module.get<EmailTemplatesService>(EmailTemplatesService);
  });

  afterEach(() => jest.clearAllMocks());

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  // ─── create ────────────────────────────────────────────────────────────

  describe('create', () => {
    const dto: CreateEmailTemplateDto = {
      name: 'Pending Review',
      subject: 'Your submission is pending review',
      body: '<p>Dear {{name}}</p>',
    };

    it('should auto-generate a slug from the name when not provided', async () => {
      mockTemplateModel.create.mockResolvedValue({ _id: 't1', slug: 'pending-review' });

      await service.create(dto);

      expect(mockTemplateModel.findOne).toHaveBeenCalledWith({ slug: 'pending-review', isDeleted: false });
      const createArg = mockTemplateModel.create.mock.calls[0][0];
      expect(createArg.slug).toBe('pending-review');
    });

    it('should use the provided slug when given', async () => {
      mockTemplateModel.create.mockResolvedValue({ _id: 't1', slug: 'custom-slug' });

      await service.create({ ...dto, slug: 'custom-slug' });

      expect(mockTemplateModel.findOne).toHaveBeenCalledWith({ slug: 'custom-slug', isDeleted: false });
    });

    it('should throw ConflictException when the slug already exists', async () => {
      mockTemplateModel.findOne.mockReturnValue(makeQueryResult({ _id: 'existing' }));

      await expect(service.create(dto)).rejects.toThrow(ConflictException);
    });
  });

  // ─── findAll ───────────────────────────────────────────────────────────

  describe('findAll', () => {
    it('should return paginated results', async () => {
      const docs = [{ _id: 't1' }, { _id: 't2' }];
      mockTemplateModel.find.mockReturnValue(makeQueryResult(docs));
      mockTemplateModel.countDocuments.mockResolvedValue(2);

      const result = await service.findAll(1, 20);

      expect(result).toEqual({ data: docs, total: 2, page: 1, limit: 20, totalPages: 1 });
    });

    it('should compute skip from page and limit', async () => {
      const query = makeQueryResult([]);
      mockTemplateModel.find.mockReturnValue(query);

      await service.findAll(2, 5);

      expect(query.skip).toHaveBeenCalledWith(5);
      expect(query.limit).toHaveBeenCalledWith(5);
    });
  });

  // ─── findOne ───────────────────────────────────────────────────────────

  describe('findOne', () => {
    it('should return the template when found', async () => {
      const tpl = { _id: 't1' };
      mockTemplateModel.findOne.mockReturnValue(makeQueryResult(tpl));

      expect(await service.findOne('t1')).toEqual(tpl);
    });

    it('should throw NotFoundException when not found', async () => {
      mockTemplateModel.findOne.mockReturnValue(makeQueryResult(null));

      await expect(service.findOne('missing')).rejects.toThrow(NotFoundException);
    });
  });

  // ─── findBySlug ────────────────────────────────────────────────────────

  describe('findBySlug', () => {
    it('should return the active template when found', async () => {
      const tpl = { _id: 't1', slug: 'pending-review', isActive: true };
      mockTemplateModel.findOne.mockReturnValue(makeQueryResult(tpl));

      expect(await service.findBySlug('pending-review')).toEqual(tpl);
    });

    it('should throw NotFoundException when not found or inactive', async () => {
      mockTemplateModel.findOne.mockReturnValue(makeQueryResult(null));

      await expect(service.findBySlug('missing')).rejects.toThrow(NotFoundException);
    });
  });

  // ─── update ────────────────────────────────────────────────────────────

  describe('update', () => {
    it('should throw ConflictException when the new slug conflicts with another template', async () => {
      mockTemplateModel.findOne.mockReturnValue(makeQueryResult({ _id: 'other' }));

      await expect(service.update('t1', { slug: 'taken' })).rejects.toThrow(ConflictException);
    });

    it('should update and return the template', async () => {
      const updated = { _id: 't1', name: 'Renamed', slug: 'renamed' };
      mockTemplateModel.findOneAndUpdate.mockReturnValue(makeQueryResult(updated));

      const result = await service.update('t1', { name: 'Renamed' });

      expect(result).toEqual(updated);
    });

    it('should throw NotFoundException when template does not exist', async () => {
      mockTemplateModel.findOneAndUpdate.mockReturnValue(makeQueryResult(null));

      await expect(service.update('missing', { name: 'x' })).rejects.toThrow(NotFoundException);
    });
  });

  // ─── remove ────────────────────────────────────────────────────────────

  describe('remove', () => {
    it('should soft-delete and return a confirmation message', async () => {
      mockTemplateModel.findOneAndUpdate.mockReturnValue(makeQueryResult({ _id: 't1', name: 'X', slug: 'x' }));

      const result = await service.remove('t1');

      expect(result.message).toContain('X');
      expect(result.message).toContain('deleted successfully');
    });

    it('should throw NotFoundException when template does not exist', async () => {
      mockTemplateModel.findOneAndUpdate.mockReturnValue(makeQueryResult(null));

      await expect(service.remove('missing')).rejects.toThrow(NotFoundException);
    });
  });

  // ─── send ──────────────────────────────────────────────────────────────

  describe('send', () => {
    const activeTemplate = { _id: 't1', isActive: true, subject: 'Hi {{name}}', body: '<p>{{name}}</p>' };

    it('should send using a stored template by templateId', async () => {
      mockTemplateModel.findOne.mockReturnValue(makeQueryResult(activeTemplate));

      const dto: SendTemplateEmailDto = { to: ['a@example.com'], templateId: 't1', variables: { name: 'Alice' } };
      const result = await service.send(dto);

      expect(mockEmailQueue.addEmailJob).toHaveBeenCalledWith({
        to: 'a@example.com',
        subject: 'Hi Alice',
        html: '<p>Alice</p>',
      });
      expect(result).toEqual({ message: '1 email(s) queued for delivery', queued: 1 });
    });

    it('should throw BadRequestException when the resolved template is inactive', async () => {
      mockTemplateModel.findOne.mockReturnValue(makeQueryResult({ ...activeTemplate, isActive: false }));

      const dto: SendTemplateEmailDto = { to: ['a@example.com'], templateId: 't1' };
      await expect(service.send(dto)).rejects.toThrow(BadRequestException);
    });

    it('should send using a stored template by templateSlug', async () => {
      mockTemplateModel.findOne.mockReturnValue(makeQueryResult({ ...activeTemplate, slug: 'pending-review' }));

      const dto: SendTemplateEmailDto = { to: ['a@example.com'], templateSlug: 'pending-review' };
      await service.send(dto);

      expect(mockEmailQueue.addEmailJob).toHaveBeenCalledTimes(1);
    });

    it('should send using raw subject/body when no template is referenced', async () => {
      const dto: SendTemplateEmailDto = {
        to: ['a@example.com', 'b@example.com'],
        subject: 'Raw subject {{name}}',
        body: '<p>Raw {{name}}</p>',
        variables: { name: 'Bob' },
      };

      const result = await service.send(dto);

      expect(mockEmailQueue.addEmailJob).toHaveBeenCalledTimes(2);
      expect(mockEmailQueue.addEmailJob).toHaveBeenNthCalledWith(1, {
        to: 'a@example.com',
        subject: 'Raw subject Bob',
        html: '<p>Raw Bob</p>',
      });
      expect(result.queued).toBe(2);
    });

    it('should throw BadRequestException when neither template nor subject/body is provided', async () => {
      const dto: SendTemplateEmailDto = { to: ['a@example.com'] };
      await expect(service.send(dto)).rejects.toThrow(BadRequestException);
    });
  });
});
