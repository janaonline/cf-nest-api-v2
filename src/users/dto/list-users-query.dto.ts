import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, IsMongoId, IsOptional } from 'class-validator';

export class ListUsersQueryDto {
  @ApiPropertyOptional({ description: 'Filter users by state ObjectId (role=STATE)', example: '5dcf9d7316a06aed41c748e8' })
  @IsOptional()
  @IsMongoId()
  stateId?: string;

  @ApiPropertyOptional({ description: 'Filter users by ULB ObjectId (role=ULB)', example: '5fa2465c072dab780a6f0f2d' })
  @IsOptional()
  @IsMongoId()
  ulbId?: string;

  @ApiPropertyOptional({ description: 'Pass true to list soft-deleted users (roles & teams page), omit or false for active users (profile verify page)', default: false })
  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  @IsBoolean()
  showDeleted?: boolean;
}
