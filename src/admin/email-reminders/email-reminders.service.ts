import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectModel } from '@nestjs/mongoose';
import { ConfigService } from '@nestjs/config';
import { Model, Types } from 'mongoose';
import { EmailQueueService } from 'src/core/queue/email-queue/email-queue.service';
import { User, UserDocument } from 'src/schemas/user/user.schema';
import { EmailTemplate, EmailTemplateDocument } from 'src/schemas/email-template.schema';
import {
  EmailReminder,
  EmailReminderDocument,
  RecipientCategory,
  ReminderStatus,
} from 'src/schemas/email-reminder.schema';
import { Role } from 'src/module/auth/enum/role.enum';
import { interpolate } from 'src/core/utils/interpolate.util';
import { PaginatedResult } from 'src/common/dto/pagination.dto';
import { CreateEmailReminderDto } from './dto/create-email-reminder.dto';
import { UpdateEmailReminderDto } from './dto/update-email-reminder.dto';

/** Maps each RecipientCategory to the user roles it covers. null = all roles. */
const CATEGORY_ROLES: Record<RecipientCategory, Role[] | null> = {
  [RecipientCategory.ALL_USERS]: null,
  [RecipientCategory.ALL_ULB]: [Role.ULB],
  [RecipientCategory.ALL_STATE]: [Role.STATE],
  [RecipientCategory.ALL_ULB_EDITORS]: [Role.ULB_EDITOR, Role.ULB_VIEWER],
  [RecipientCategory.ALL_STATE_EDITORS]: [Role.STATE_EDITOR, Role.STATE_VIEWER],
  [RecipientCategory.ONLY_ADMIN]: [Role.ADMIN],
  [RecipientCategory.ONLY_MOHUA]: [Role.MoHUA],
  [RecipientCategory.ONLY_ME]: null, // resolved separately via TEST_RECIPIENT_EMAIL
};

export interface DispatchResult {
  reminderId: string;
  name: string;
  recipientCount: number;
  queued: number;
}

@Injectable()
export class EmailRemindersService {
  private readonly logger = new Logger(EmailRemindersService.name);

  constructor(
    @InjectModel(EmailReminder.name) private readonly reminderModel: Model<EmailReminderDocument>,
    @InjectModel(EmailTemplate.name) private readonly templateModel: Model<EmailTemplateDocument>,
    @InjectModel(User.name) private readonly userModel: Model<UserDocument>,
    private readonly emailQueue: EmailQueueService,
    private readonly config: ConfigService,
  ) {}

  // ─── Cron: every minute — dispatches any reminder whose time has arrived ───

  @Cron('* * * * *', { timeZone: 'Asia/Kolkata' })
  async handleDailyCron(): Promise<void> {
    const due = await this.findDueReminders();
    if (!due.length) {
      // this.logger.log('No reminders due today');
      return;
    }
    this.logger.log(`Found ${due.length} reminder(s) due today`);
    for (const reminder of due) {
      await this.dispatchReminder(reminder);
    }
  }

  // ─── CRUD ────────────────────────────────────────────────────────────────────

  async create(dto: CreateEmailReminderDto): Promise<EmailReminderDocument> {
    const template = await this.templateModel.findOne({ _id: dto.templateId, isDeleted: false }).exec();
    if (!template) throw new NotFoundException(`Template ${dto.templateId} not found`);
    if (!template.isActive) throw new BadRequestException('Selected template is inactive');

    const reminderTime = dto.reminderTime ?? '09:00';
    const reminderDate = this.calcReminderDate(dto.deadlineDate, dto.reminderDaysBefore, reminderTime);
    if (reminderDate < new Date()) {
      throw new BadRequestException(
        `Reminder date (${reminderDate.toUTCString()}) is in the past. ` +
          `Increase reminderDaysBefore or pick a future deadlineDate/reminderTime.`,
      );
    }

    const reminder = await this.reminderModel.create({
      name: dto.name,
      templateId: new Types.ObjectId(dto.templateId),
      deadlineDate: new Date(dto.deadlineDate),
      reminderDaysBefore: dto.reminderDaysBefore,
      reminderTime,
      reminderDate,
      recipientCategory: dto.recipientCategory,
      variables: dto.variables ?? {},
      status: ReminderStatus.PENDING,
    });

    this.logger.log(
      `Reminder "${reminder.name}" created — fires on ${reminderDate.toUTCString()} → category: ${dto.recipientCategory}`,
    );
    return reminder;
  }

  async findAll(page = 1, limit = 20): Promise<PaginatedResult<EmailReminderDocument>> {
    const skip = (page - 1) * limit;
    const [data, total] = await Promise.all([
      this.reminderModel
        .find({ isDeleted: false })
        .populate('templateId', 'name slug subject')
        .sort({ reminderDate: 1 })
        .skip(skip)
        .limit(limit)
        .exec(),
      this.reminderModel.countDocuments({ isDeleted: false }),
    ]);
    return { data, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  async findOne(id: string): Promise<EmailReminderDocument> {
    const reminder = await this.reminderModel
      .findOne({ _id: id, isDeleted: false })
      .populate('templateId', 'name slug subject body')
      .exec();
    if (!reminder) throw new NotFoundException('Email reminder not found');
    return reminder;
  }

  async update(id: string, dto: UpdateEmailReminderDto): Promise<EmailReminderDocument> {
    const existing = await this.findOne(id);
    if (existing.status === ReminderStatus.SENT) {
      throw new BadRequestException('Cannot update a reminder that has already been sent');
    }

    const patch: Partial<EmailReminder & { reminderDate: Date }> = { ...dto } as never;

    const newDeadline = dto.deadlineDate ?? existing.deadlineDate.toISOString().split('T')[0];
    const newDaysBefore = dto.reminderDaysBefore ?? existing.reminderDaysBefore;
    const newReminderTime = dto.reminderTime ?? existing.reminderTime ?? '09:00';
    const newReminderDate = this.calcReminderDate(newDeadline, newDaysBefore, newReminderTime);

    if (newReminderDate < new Date()) {
      throw new BadRequestException(`Recalculated reminder date (${newReminderDate.toUTCString()}) is in the past`);
    }

    patch.reminderDate = newReminderDate;
    if (dto.deadlineDate) patch.deadlineDate = new Date(dto.deadlineDate) as never;

    if (dto.deadlineDate || dto.reminderDaysBefore || dto.reminderTime) {
      (patch as Record<string, unknown>).status = ReminderStatus.PENDING;
      (patch as Record<string, unknown>).sentAt = null;
    }

    if (dto.templateId) {
      const template = await this.templateModel.findOne({ _id: dto.templateId, isDeleted: false }).exec();
      if (!template) throw new NotFoundException(`Template ${dto.templateId} not found`);
    }

    const updated = await this.reminderModel
      .findByIdAndUpdate(id, { $set: patch }, { new: true, runValidators: true })
      .exec();

    if (!updated) throw new NotFoundException('Email reminder not found');
    this.logger.log(`Reminder "${updated.name}" updated — new fire date: ${updated.reminderDate.toUTCString()}`);
    return updated;
  }

  async cancel(id: string): Promise<{ message: string }> {
    const reminder = await this.reminderModel
      .findOneAndUpdate(
        { _id: id, isDeleted: false },
        { $set: { isDeleted: true, isActive: false, status: ReminderStatus.CANCELLED } },
        { new: true },
      )
      .exec();
    if (!reminder) throw new NotFoundException('Email reminder not found');
    this.logger.log(`Reminder "${reminder.name}" cancelled`);
    return { message: `Reminder "${reminder.name}" has been cancelled` };
  }

  async triggerNow(id: string): Promise<DispatchResult> {
    const reminder = await this.reminderModel.findOne({ _id: id, isDeleted: false }).exec();
    if (!reminder) throw new NotFoundException('Email reminder not found');
    return this.dispatchReminder(reminder);
  }

  async previewRecipients(category: RecipientCategory): Promise<{ category: string; count: number; emails: string[] }> {
    const users = await this.resolveRecipients(category);
    return { category, count: users.length, emails: users.map((u) => u.email) };
  }

  // ─── Core dispatch ────────────────────────────────────────────────────────

  private async dispatchReminder(reminder: EmailReminderDocument): Promise<DispatchResult> {
    const template = await this.templateModel.findById(reminder.templateId).exec();

    if (!template || !template.isActive) {
      await this.markFailed(reminder, 'Template not found or inactive');
      return { reminderId: reminder.id as string, name: reminder.name, recipientCount: 0, queued: 0 };
    }

    const recipients = await this.resolveRecipients(reminder.recipientCategory);
    if (!recipients.length) {
      this.logger.warn(`Reminder "${reminder.name}": no recipients for category ${reminder.recipientCategory}`);
      await this.markSent(reminder, 0);
      return { reminderId: reminder.id as string, name: reminder.name, recipientCount: 0, queued: 0 };
    }

    for (const recipient of recipients) {
      const variables: Record<string, string> = {
        ...reminder.variables,
        name: recipient.name?.trim() || 'User',
      };
      const subject = interpolate(template.subject, variables);
      const body = interpolate(template.body, variables);
      await this.emailQueue.addEmailJob({ to: recipient.email, subject, html: body });
    }

    await this.markSent(reminder, recipients.length);
    this.logger.log(`Reminder "${reminder.name}" — ${recipients.length} email(s) queued`);
    return {
      reminderId: reminder.id as string,
      name: reminder.name,
      recipientCount: recipients.length,
      queued: recipients.length,
    };
  }

  // ─── Recipient resolution ─────────────────────────────────────────────────

  private async resolveRecipients(category: RecipientCategory): Promise<{ name: string; email: string }[]> {
    if (category === RecipientCategory.ONLY_ME) {
      const testEmail = this.config.get<string>('TEST_RECIPIENT_EMAIL');
      if (!testEmail) {
        this.logger.warn('ONLY_ME selected but TEST_RECIPIENT_EMAIL is not set in .env — no recipients');
        return [];
      }
      this.logger.log(`ONLY_ME: sending to ${testEmail}`);
      return [{ name: 'Test User', email: testEmail.trim().toLowerCase() }];
    }

    const roles = CATEGORY_ROLES[category];
    const roleFilter = roles ? { role: { $in: roles } } : {};

    const users = await this.userModel
      .find({ isDeleted: false, email: { $exists: true, $nin: ['', null] }, ...roleFilter })
      .select('name email role')
      .lean()
      .exec();

    const seen = new Set<string>();
    return users.reduce<{ name: string; email: string }[]>((acc, u) => {
      const email = (u.email as string)?.trim().toLowerCase();
      if (!email || seen.has(email)) return acc;
      seen.add(email);
      acc.push({ name: (u.name as string) ?? '', email });
      return acc;
    }, []);
  }

  // ─── Due reminders lookup ─────────────────────────────────────────────────

  private async findDueReminders(): Promise<EmailReminderDocument[]> {
    // Any pending reminder whose scheduled UTC time has arrived
    return this.reminderModel
      .find({
        isDeleted: false,
        isActive: true,
        status: ReminderStatus.PENDING,
        reminderDate: { $lte: new Date() },
      })
      .exec();
  }

  // ─── Status helpers ───────────────────────────────────────────────────────

  private async markSent(reminder: EmailReminderDocument, queued: number): Promise<void> {
    await this.reminderModel.findByIdAndUpdate(reminder._id, {
      $set: { status: ReminderStatus.SENT, sentAt: new Date(), sentCount: queued, failedCount: 0 },
    });
  }

  private async markFailed(reminder: EmailReminderDocument, error: string): Promise<void> {
    await this.reminderModel.findByIdAndUpdate(reminder._id, {
      $set: { status: ReminderStatus.FAILED, lastError: error },
    });
  }

  // ─── Helpers ─────────────────────────────────────────────────────────────

  /**
   * Converts the user-supplied IST time (HH:MM) to UTC and stores it on the reminder date.
   * IST = UTC + 5:30, so UTC = IST - 5:30 (330 minutes).
   * Handles midnight rollover (e.g. 02:00 IST = 20:30 UTC previous day).
   */
  private calcReminderDate(deadlineDateStr: string, daysBefore: number, reminderTime: string): Date {
    const [hStr, mStr] = reminderTime.split(':');
    const istMinutes = parseInt(hStr, 10) * 60 + parseInt(mStr, 10);
    let utcMinutes = istMinutes - 330; // subtract IST offset (5h30m)
    let dayOffset = 0;
    if (utcMinutes < 0) {
      utcMinutes += 1440; // wrap past midnight
      dayOffset = -1;
    }

    const deadline = new Date(deadlineDateStr); // parsed as UTC midnight
    const reminderDay = new Date(
      Date.UTC(deadline.getUTCFullYear(), deadline.getUTCMonth(), deadline.getUTCDate() - daysBefore + dayOffset),
    );
    reminderDay.setUTCHours(Math.floor(utcMinutes / 60), utcMinutes % 60, 0, 0);
    return reminderDay;
  }
}
