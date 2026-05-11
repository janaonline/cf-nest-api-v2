import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsEnum, IsNumber, IsOptional, IsString, Max, Min } from 'class-validator';
import { CONTEXT_TYPE, THREAD_PURPOSE } from '../../common/constants/communication.constants';

export class GetThreadsDto {
  @IsOptional()
  @IsString()
  financialYear?: string;

  @IsOptional()
  @IsEnum(CONTEXT_TYPE)
  contextType?: string;

  @IsOptional()
  @IsEnum(THREAD_PURPOSE)
  threadPurpose?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  currentFormStatus?: number;

  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  @IsBoolean()
  unreadOnly?: boolean;

  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  @Max(100)
  limit?: number = 20;
}
