import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsDateString,
  IsEnum,
  IsInt,
  IsMongoId,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
} from 'class-validator';
import { RecipientCategory } from 'src/schemas/email-reminder.schema';

export class CreateEmailReminderDto {
  @ApiProperty({ example: 'FY 2026-27 Submission Deadline Reminder' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(150)
  name!: string;

  @ApiProperty({ example: '665abc123def456789012345', description: 'ID of the email template to use' })
  @IsMongoId()
  templateId!: string;

  @ApiProperty({ example: '2026-06-10', description: 'The actual deadline date (YYYY-MM-DD)' })
  @IsDateString()
  deadlineDate!: string;

  @ApiProperty({ example: 5, description: 'Send reminder this many days before the deadline' })
  @IsInt()
  @Min(1)
  reminderDaysBefore!: number;

  @ApiPropertyOptional({
    example: '09:00',
    description: 'Time in IST (HH:MM, 24-hour) when the reminder fires. Defaults to 09:00.',
    default: '09:00',
  })
  @IsOptional()
  @IsString()
  @Matches(/^\d{2}:\d{2}$/, { message: 'reminderTime must be in HH:MM format (e.g. 09:00, 14:30)' })
  reminderTime?: string;

  @ApiProperty({
    enum: RecipientCategory,
    example: RecipientCategory.ALL_STATE,
    description: [
      'ALL_USERS — everyone with an email in the DB',
      'ALL_ULB — users with role ULB',
      'ALL_STATE — users with role STATE',
      'ALL_ULB_EDITORS — ULB-EDITOR + ULB-VIEWER roles',
      'ALL_STATE_EDITORS — STATE-EDITOR + STATE-VIEWER roles',
      'ONLY_ADMIN — ADMIN role',
      'ONLY_MOHUA — MoHUA role',
      'ONLY_ME — test only, sends to TEST_RECIPIENT_EMAIL',
    ].join(' | '),
  })
  @IsEnum(RecipientCategory)
  recipientCategory!: RecipientCategory;

  @ApiPropertyOptional({
    example: { fy: '2026-27', deadline: '10 June 2026', dashboardUrl: 'https://cityfinance.in' },
    description: 'Values to replace {{variable}} placeholders in the template',
  })
  @IsOptional()
  @IsObject()
  @Transform(({ value }: { value: unknown }) => (value && typeof value === 'object' ? value : {}))
  variables?: Record<string, string>;
}
