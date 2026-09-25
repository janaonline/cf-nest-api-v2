import { Body, Controller, Headers, Ip, Patch, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ApiEnvelope } from 'src/common/decorators/api-envelope.decorator';
import { CurrentUser } from 'src/module/auth/decorators/current-user.decorator';
import { Roles } from 'src/module/auth/decorators/roles.decorator';
import * as roleEnum from 'src/module/auth/enum/role.enum';
import { RolesGuard } from 'src/module/auth/guards/roles.guard';
import { ReverseDataCollectionDto } from '../dto/reverse-data-collection.dto';
import { DataCollectionService } from '../services/data-collection.service';

@ApiEnvelope()
@ApiTags('data-collection-admin')
@ApiBearerAuth()
@UseGuards(RolesGuard)
@Roles([roleEnum.Role.ADMIN])
@Controller('data-collection/admin')
export class DataCollectionAdminController {
  constructor(private readonly dataCollectionService: DataCollectionService) {}

  @Patch('reverse')
  @ApiOperation({
    summary: 'Reverse data collection submission',
    description:
      'Marks an active data collection record as reversed (soft delete). The record is retained for audit purposes. Reversed records no longer block corrected resubmission.',
  })
  reverseSubmission(
    @Body() dto: ReverseDataCollectionDto,
    @CurrentUser() user: roleEnum.User,
    @Ip() ip: string,
    @Headers('user-agent') userAgent?: string,
  ) {
    return this.dataCollectionService.reverseSubmission(dto, user, { ip, userAgent });
  }
}
