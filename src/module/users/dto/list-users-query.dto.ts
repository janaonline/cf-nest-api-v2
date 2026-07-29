import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsMongoId, IsOptional } from 'class-validator';

export class ListUsersQueryDto {
  @ApiPropertyOptional({
    description: 'Filter users by state ObjectId (role=STATE)',
    example: '5dcf9d7316a06aed41c748e8',
  })
  @IsOptional()
  @IsMongoId()
  stateId?: string;

  @ApiPropertyOptional({ description: 'Filter users by ULB ObjectId (role=ULB)', example: '5fa2465c072dab780a6f0f2d' })
  @IsOptional()
  @IsMongoId()
  ulbId?: string;

  @ApiPropertyOptional({ description: 'Include deleted users in the response', example: false })
  @IsOptional()
  showDeleted?: boolean;
}
