import { BadRequestException, Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import type { AuthUser } from '../../../auth/auth-user.interface';
import { CurrentUser } from '../../../auth/decorators/current-user.decorator';
import { UnspentBalanceDisclosureService } from './unspent-balance-disclosure.service';
import { SubmitDisclosureDto } from './dto/submit-disclosure.dto';
import { UpdateDisclosureDto } from './dto/update-disclosure.dto';

@Controller('xvi-fc/unspent-balance-disclosure')
export class UnspentBalanceDisclosureController {
  constructor(private readonly service: UnspentBalanceDisclosureService) {}

  /** Submit (or re-submit) a disclosure. Upserts on (ulb, designYear). */
  @Post()
  submit(@Body() dto: SubmitDisclosureDto, @CurrentUser() user: AuthUser) {
    return this.service.submit(dto, user);
  }

  /** Fetch the disclosure for a given ULB and design year. */
  @Get()
  getByYear(
    @Query('yearId') yearId: string,
    @Query('ulbId') ulbId: string | undefined,
    @CurrentUser() user: AuthUser,
  ) {
    const resolvedUlbId = user.ulb ?? ulbId;
    if (!resolvedUlbId) throw new BadRequestException('ulbId is required.');
    return this.service.getByUlbAndYear(resolvedUlbId, yearId);
  }

  /** Partially update an existing disclosure by its document ID. */
  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateDisclosureDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.update(id, dto, user);
  }

  /** Generate a presigned S3 GET URL for a document attached to this disclosure. */
  @Get(':id/documents/signed-url')
  getDocumentSignedUrl(
    @Param('id') id: string,
    @Query('filepath') filepath: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.getDocumentSignedUrl(id, filepath, user);
  }
}
