import { Body, Controller, Get, Headers, Ip, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from 'src/module/auth/decorators/current-user.decorator';
import { Roles } from 'src/module/auth/decorators/roles.decorator';
import * as roleEnum from 'src/module/auth/enum/role.enum';
import { RolesGuard } from 'src/module/auth/guards/roles.guard';
import { ApiClientService } from './services/api-client.service';
import { CreateApiClientDto } from './dto/create-api-client.dto';
import { ListApiClientsQueryDto } from './dto/list-api-clients-query.dto';
import { RotateSecretDto } from './dto/rotate-secret.dto';
import { UpdateApiClientStatusDto } from './dto/update-api-client-status.dto';

@ApiTags('api-clients')
@ApiBearerAuth()
@UseGuards(RolesGuard)
@Roles([roleEnum.Role.ADMIN])
@Controller('api-clients')
export class ApiClientsController {
  constructor(private readonly apiClientService: ApiClientService) {}

  @Post()
  @ApiOperation({
    summary: 'Create API client',
    description: 'Creates an integration client, validates state/ULB references, and returns the secret once.',
  })
  create(
    @Body() dto: CreateApiClientDto,
    @CurrentUser() user: roleEnum.User,
    @Ip() ip: string,
    @Headers('user-agent') userAgent?: string,
  ) {
    return this.apiClientService.createApiClient(dto, user?._id, { ip, userAgent });
  }

  @Get()
  @ApiOperation({
    summary: 'List API clients',
    description: 'Lists integration clients with pagination, filtering, and search.',
  })
  list(@Query() query: ListApiClientsQueryDto) {
    return this.apiClientService.listApiClients(query);
  }

  @Get(':clientId')
  @ApiOperation({
    summary: 'Get API client',
    description: 'Returns one integration client by clientId without secrets.',
  })
  getOne(@Param('clientId') clientId: string) {
    return this.apiClientService.getApiClient(clientId);
  }

  @Patch(':clientId/rotate-secret')
  @ApiOperation({
    summary: 'Rotate API client secret',
    description: 'Generates and returns a new secret once. Previous secret is immediately invalid.',
  })
  rotateSecret(
    @Param('clientId') clientId: string,
    @Body() dto: RotateSecretDto,
    @CurrentUser() user: roleEnum.User,
    @Ip() ip: string,
    @Headers('user-agent') userAgent?: string,
  ) {
    return this.apiClientService.rotateSecret(clientId, dto, user?._id, { ip, userAgent });
  }

  @Patch(':clientId/status')
  @ApiOperation({
    summary: 'Update API client status',
    description: 'Enables, disables, or revokes an integration client. Revoked clients cannot obtain tokens.',
  })
  updateStatus(
    @Param('clientId') clientId: string,
    @Body() dto: UpdateApiClientStatusDto,
    @CurrentUser() user: roleEnum.User,
    @Ip() ip: string,
    @Headers('user-agent') userAgent?: string,
  ) {
    return this.apiClientService.updateStatus(clientId, dto.status, user?._id, { ip, userAgent }, dto.reason);
  }
}
