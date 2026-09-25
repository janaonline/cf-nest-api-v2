import { ApiPropertyOptional } from '@nestjs/swagger';
import { ArrayUnique, IsArray, IsEnum, IsOptional } from 'class-validator';
import { Permission } from 'src/module/auth/enum/roles-xvi-fc.enum';

export class UpdatePermissionOverridesDto {
  @ApiPropertyOptional({
    description: 'Permissions to grant beyond the role default',
    enum: Permission,
    isArray: true,
    example: [Permission.APPROVE_ULB_SUBMISSIONS],
  })
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsEnum(Permission, { each: true })
  allow?: Permission[];

  @ApiPropertyOptional({
    description: 'Permissions to revoke from the role default',
    enum: Permission,
    isArray: true,
    example: [Permission.MESSAGE_USERS],
  })
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsEnum(Permission, { each: true })
  deny?: Permission[];
}
