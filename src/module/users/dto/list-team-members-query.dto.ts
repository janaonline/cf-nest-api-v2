import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsMongoId, IsOptional } from 'class-validator';

export class ListTeamMembersQueryDto {
  @ApiPropertyOptional({ description: 'Filter by ULB ObjectId', example: '5fa2465c072dab780a6f0f2d' })
  @IsOptional()
  @IsMongoId()
  ulbId?: string;

  @ApiPropertyOptional({ description: 'Filter by State ObjectId — returns only STATE/STATE_EDITOR/STATE_VIEWER roles', example: '5dcf9d7316a06aed41c748e8' })
  @IsOptional()
  @IsMongoId()
  stateId?: string;
}
