import { Body, Controller, Headers, Ip, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { TokenRequestDto } from 'src/module/api-clients/dto/token-request.dto';
import { IntegrationAuthService } from './integration-auth.service';

@ApiTags('data-collection-auth')
@Controller('data-collection/auth')
export class IntegrationAuthController {
  constructor(private readonly integrationAuthService: IntegrationAuthService) {}

  @Post('token')
  @ApiOperation({
    summary: 'Create integration token',
    description: 'Returns a short-lived bearer token for API clients. No authentication required.',
  })
  createToken(@Body() payload: TokenRequestDto, @Ip() ip: string, @Headers('user-agent') userAgent?: string) {
    return this.integrationAuthService.createToken(payload, ip ?? '', userAgent);
  }
}
