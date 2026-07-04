import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { EmailQueueService } from 'src/core/queue/email-queue/email-queue.service';
import { EmailTemplate, EmailTemplateDocument } from 'src/schemas/email-template.schema';
import { interpolate } from 'src/core/utils/interpolate.util';
import { PaginatedResult } from 'src/common/dto/pagination.dto';
import { CreateEmailTemplateDto } from './dto/create-email-template.dto';
import { SendTemplateEmailDto } from './dto/send-template-email.dto';
import { UpdateEmailTemplateDto } from './dto/update-email-template.dto';

@Injectable()
export class EmailTemplatesService {
  private readonly logger = new Logger(EmailTemplatesService.name);

  constructor(
    @InjectModel(EmailTemplate.name) private readonly templateModel: Model<EmailTemplateDocument>,
    private readonly emailQueue: EmailQueueService,
  ) {}

  // ─── CRUD ────────────────────────────────────────────────────────────────────

  async create(dto: CreateEmailTemplateDto): Promise<EmailTemplateDocument> {
    const slug = dto.slug ?? this.toSlug(dto.name);

    const exists = await this.templateModel.findOne({ slug, isDeleted: false }).exec();
    if (exists) throw new ConflictException(`A template with slug "${slug}" already exists`);

    const template = await this.templateModel.create({ ...dto, slug });
    this.logger.log(`Template created: ${slug}`);
    return template;
  }

  async findAll(page = 1, limit = 20): Promise<PaginatedResult<EmailTemplateDocument>> {
    const skip = (page - 1) * limit;
    const [data, total] = await Promise.all([
      this.templateModel.find({ isDeleted: false }).sort({ createdAt: -1 }).skip(skip).limit(limit).exec(),
      this.templateModel.countDocuments({ isDeleted: false }),
    ]);
    return { data, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  async findOne(id: string): Promise<EmailTemplateDocument> {
    const template = await this.templateModel.findOne({ _id: id, isDeleted: false }).exec();
    if (!template) throw new NotFoundException('Email template not found');
    return template;
  }

  async findBySlug(slug: string): Promise<EmailTemplateDocument> {
    const template = await this.templateModel.findOne({ slug, isDeleted: false, isActive: true }).exec();
    if (!template) throw new NotFoundException(`Template with slug "${slug}" not found`);
    return template;
  }

  async update(id: string, dto: UpdateEmailTemplateDto): Promise<EmailTemplateDocument> {
    if (dto.slug) {
      const conflict = await this.templateModel.findOne({ slug: dto.slug, isDeleted: false, _id: { $ne: id } }).exec();
      if (conflict) throw new ConflictException(`Slug "${dto.slug}" is already used by another template`);
    }

    const updated = await this.templateModel
      .findOneAndUpdate({ _id: id, isDeleted: false }, { $set: dto }, { new: true, runValidators: true })
      .exec();

    if (!updated) throw new NotFoundException('Email template not found');
    this.logger.log(`Template updated: ${updated.slug}`);
    return updated;
  }

  async remove(id: string): Promise<{ message: string }> {
    const template = await this.templateModel
      .findOneAndUpdate({ _id: id, isDeleted: false }, { $set: { isDeleted: true, isActive: false } }, { new: true })
      .exec();

    if (!template) throw new NotFoundException('Email template not found');
    this.logger.log(`Template deleted: ${template.slug}`);
    return { message: `Template "${template.name}" deleted successfully` };
  }

  // ─── Send ─────────────────────────────────────────────────────────────────────

  async send(dto: SendTemplateEmailDto): Promise<{ message: string; queued: number }> {
    let subject: string;
    let body: string;

    if (dto.templateId) {
      const tpl = await this.findOne(dto.templateId);
      if (!tpl.isActive) throw new BadRequestException('This template is inactive');
      subject = interpolate(tpl.subject, dto.variables);
      body = interpolate(tpl.body, dto.variables);
    } else if (dto.templateSlug) {
      const tpl = await this.findBySlug(dto.templateSlug);
      subject = interpolate(tpl.subject, dto.variables);
      body = interpolate(tpl.body, dto.variables);
    } else {
      if (!dto.subject || !dto.body) {
        throw new BadRequestException('Provide templateId, templateSlug, or both subject and body');
      }
      subject = interpolate(dto.subject, dto.variables);
      body = interpolate(dto.body, dto.variables);
    }

    // Queue one job per recipient so failures are tracked individually
    for (const email of dto.to) {
      await this.emailQueue.addEmailJob({ to: email, subject, html: body });
    }

    this.logger.log(`Queued ${dto.to.length} email(s): "${subject}"`);
    return { message: `${dto.to.length} email(s) queued for delivery`, queued: dto.to.length };
  }

  // ─── Helpers ─────────────────────────────────────────────────────────────────

  private toSlug(name: string): string {
    return name
      .toLowerCase()
      .trim()
      .replace(/\s+/g, '-')
      .replace(/[^a-z0-9-]/g, '');
  }
}
