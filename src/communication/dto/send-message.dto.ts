import { IsArray, IsEnum, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { MESSAGE_VISIBILITY } from '../../common/constants/communication.constants';

export class SendMessageDto {
  @IsString()
  @MinLength(1)
  @MaxLength(5000)
  body!: string;

  @IsOptional()
  @IsArray()
  attachments?: Record<string, any>[];

  @IsOptional()
  @IsEnum(MESSAGE_VISIBILITY)
  visibility?: MESSAGE_VISIBILITY;

  @IsOptional()
  @IsString()
  parentMessageId?: string;
}
