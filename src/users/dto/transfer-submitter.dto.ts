import { ApiProperty } from '@nestjs/swagger';
import { IsMongoId } from 'class-validator';

export class TransferSubmitterDto {
  @ApiProperty({ description: 'User ID of the STATE reviewer or viewer who will become the new admin/submitter' })
  @IsMongoId()
  toUserId!: string;
}
