import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsArray,
  IsDateString,
  IsIn,
  IsMongoId,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUrl,
  MaxLength,
  MinLength,
} from 'class-validator';
import { CONSTRAINTS, EventStatus } from 'src/schemas/events.schema';

export class CreateEventDto {
  @ApiProperty({
    example: 'WEBINAR ALERT',
    description: 'Title of the event or webinar. Maximum and minimum length constraints apply.',
  })
  @IsNotEmpty()
  @IsString()
  @MaxLength(CONSTRAINTS.title.maxLength)
  @MinLength(CONSTRAINTS.title.minLength)
  title: string;

  @ApiProperty({
    example: 'Join our webinar on Jan 7th, 2025 for a deep dive into revenue performance.',
    description: 'Detailed description of the event. Maximum and minimum length constraints apply.',
  })
  @IsNotEmpty()
  @IsString()
  @MaxLength(CONSTRAINTS.desc.maxLength)
  @MinLength(CONSTRAINTS.desc.minLength)
  desc: string;

  @ApiProperty({
    example: 1,
    description: 'Status of the event. Allowed values are: 0 (Inactive), 1 (Active), 2 (Draft).',
  })
  @IsNotEmpty({ message: `eventStatus must be ${Object.values(EventStatus)}` })
  @IsIn(Object.values(EventStatus))
  eventStatus: EventStatus;

  @ApiProperty({
    example: '2025-01-07T05:30:00.000Z',
    description: 'Event start date and time in UTC. Format: YYYY-MM-DDTHH:mm:ss.sssZ',
  })
  @IsDateString()
  @IsNotEmpty()
  startAt: Date;

  @ApiProperty({
    example: '2025-01-07T06:30:00.000Z',
    description: 'Event end date and time in UTC. Format: YYYY-MM-DDTHH:mm:ss.sssZ',
  })
  @IsDateString()
  @IsNotEmpty()
  endAt: Date;

  @ApiProperty({
    example: 'https://extrnal-form-link.com',
    description: 'External form link',
  })
  @IsOptional()
  @IsUrl()
  redirectionLink?: string;

  @ApiPropertyOptional({
    example: '6402dd7803b5a6b6c2cb6d43',
    description: 'If internal form is used then _id of document in formJson',
  })
  @IsOptional()
  @IsMongoId()
  formId?: string;

  @ApiPropertyOptional({
    example: ['Register for event.'],
    description: 'Button labels to be shown on portal',
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  buttonLabels?: string[];

  @ApiPropertyOptional({
    example: ['/files/svg/Overview_a2aa2c3b-f8bc-43db-b163-44412a92e530.svg'],
    description: 'Image URLs or Logos to be shown on portal',
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  imgUrl?: string[];
}
