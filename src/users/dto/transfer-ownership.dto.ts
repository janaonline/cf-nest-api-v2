import { ApiProperty } from '@nestjs/swagger';
import { IsEnum, IsMongoId } from 'class-validator';
import { Role } from 'src/module/auth/enum/role.enum';

const ULB_DEMOTION_ROLES = [Role.ULB_EDITOR, Role.ULB_VIEWER] as const;
const STATE_DEMOTION_ROLES = [Role.STATE_EDITOR, Role.STATE_VIEWER] as const;
export const VALID_DEMOTION_ROLES = [...ULB_DEMOTION_ROLES, ...STATE_DEMOTION_ROLES];

export class TransferOwnershipDto {
  @ApiProperty({ description: 'User ID of the ULB-EDITOR or ULB-VIEWER who will become the new owner' })
  @IsMongoId()
  newOwnerId!: string;

  @ApiProperty({
    enum: VALID_DEMOTION_ROLES,
    description: 'Role the current owner will be downgraded to after transfer',
    example: Role.ULB_EDITOR,
  })
  @IsEnum(VALID_DEMOTION_ROLES)
  demoteTo!: typeof VALID_DEMOTION_ROLES[number];
}
