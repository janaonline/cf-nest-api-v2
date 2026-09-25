import { ApiProperty } from '@nestjs/swagger';
import { IsEnum } from 'class-validator';
import { Role } from 'src/module/auth/enum/role.enum';

export class UpdateUserRoleDto {
  @ApiProperty({ enum: Role, description: 'New role to assign to the user' })
  @IsEnum(Role)
  role!: Role;
}
