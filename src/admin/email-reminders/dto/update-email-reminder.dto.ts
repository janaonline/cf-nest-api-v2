import { PartialType } from '@nestjs/swagger';
import { CreateEmailReminderDto } from './create-email-reminder.dto';

export class UpdateEmailReminderDto extends PartialType(CreateEmailReminderDto) {}
