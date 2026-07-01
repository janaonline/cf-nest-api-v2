import { ApiProperty } from '@nestjs/swagger';
import { IsIn } from 'class-validator';

// Frontend sends display values; backend maps to DB values (reviewer / viewer)
export type StateSubRoleDisplay = 'EDITOR' | 'VIEWER';

export class UpdateXviFcSubroleDto {
  @ApiProperty({
    enum: ['EDITOR', 'VIEWER'],
    description: 'New sub-role for the STATE user. EDITOR maps to reviewer, VIEWER maps to viewer in the DB.',
    example: 'EDITOR',
  })
  @IsIn(['EDITOR', 'VIEWER'])
  subRole!: StateSubRoleDisplay;
}
