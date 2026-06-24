import { ApiProperty } from '@nestjs/swagger';
import { IsIn } from 'class-validator';
import { MANAGED_ROLES } from 'src/module/auth/enum/roles-xvi-fc.enum';
import type { ManagedRole } from 'src/module/auth/enum/roles-xvi-fc.enum';

export class UpdateUserRoleDto {
  @ApiProperty({
    enum: MANAGED_ROLES,
    description:
      'New role to assign. Only managed (non-submitter) roles are accepted: ' +
      MANAGED_ROLES.join(', '),
  })
  @IsIn([...MANAGED_ROLES], {
    message: `role must be one of: ${MANAGED_ROLES.join(', ')}`,
  })
  role!: ManagedRole;
}
