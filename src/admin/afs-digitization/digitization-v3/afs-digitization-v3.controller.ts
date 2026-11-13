import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth } from '@nestjs/swagger';
import { Roles } from 'src/module/auth/decorators/roles.decorator';
import { Role } from 'src/module/auth/enum/role.enum';
import { RolesGuard } from 'src/module/auth/guards/roles.guard';
import { AfsDigitizationV3QueryDto } from '../dto/afs-digitization-v3-query.dto';
import { AfsDigitizationV3QueueService } from './afs-digitization-v3-queue.service';
import { AfsDigitizationV3Service } from './afs-digitization-v3.service';
import { Public } from 'src/module/auth/decorators/public.decorator';

@ApiBearerAuth()
@UseGuards(RolesGuard)
@Roles([Role.ADMIN, Role.AFS_ADMIN])
@Controller('afs-digitization-v3')
export class AfsDigitizationV3Controller {
  constructor(
    private readonly digitizationV3Service: AfsDigitizationV3Service,
    private readonly queueService: AfsDigitizationV3QueueService,
  ) {}

  /** Paginated list (one row per ULB) plus the card counts for the chosen year / audit type / doc type. */
  @Post('list')
  @HttpCode(HttpStatus.OK)
  list(@Body() body: AfsDigitizationV3QueryDto) {
    return this.digitizationV3Service.list(body);
  }

  /** Overall cards (total / digitized / queued / processing / failed) across every year and doc type, from `afs_metrics`. */
  @Get('metrics')
  @Public()
  async metrics() {
    return { success: true, data: await this.digitizationV3Service.getMetrics() };
  }

  /** Unique files / pages per year, doc type, state and audit type (all optional filters), from the uniqueness baseline. */
  @Get('metrics/breakdown')
  async breakdown(
    @Query('year') year?: string,
    @Query('docType') docType?: string,
    @Query('state') state?: string,
    @Query('auditType') auditType?: string,
  ) {
    return {
      success: true,
      data: await this.digitizationV3Service.getUniquenessBreakdown({ year, docType, state, auditType }),
    };
  }

  /** Recounts the overall cards from the records. Only needed to fix drift; the cards are kept up to date by the jobs. */
  @Post('metrics/rebuild')
  @Public()
  @HttpCode(HttpStatus.OK)
  async rebuildMetrics() {
    return { success: true, data: await this.digitizationV3Service.rebuildMetrics() };
  }

  /** Recounts the unique files / pages to digitize (the `total` card) from the annual accounts. Reads every account, so it takes a while. */
  @Post('metrics/rebuild-uniqueness')
  @Public()
  @HttpCode(HttpStatus.OK)
  async rebuildUniqueness() {
    return { success: true, data: await this.digitizationV3Service.rebuildUniqueness() };
  }

  /** FastAPI's log for one job: status, progress step, error and warnings, timestamps. */
  @Get('jobs/:afsDigitizationJobId/log')
  async jobLog(@Param('afsDigitizationJobId') afsDigitizationJobId: string) {
    // `success` keeps the global response interceptor from wrapping the reply a second time
    return { success: true, data: await this.queueService.getJobLog(afsDigitizationJobId) };
  }

  /** Filter once, queue every matching file. Skips files with no PDF or already queued / digitized. */
  @Post('enqueue-by-filter')
  @HttpCode(HttpStatus.ACCEPTED)
  enqueueByFilter(@Body() body: AfsDigitizationV3QueryDto) {
    return this.digitizationV3Service.enqueueByFilter(body);
  }

  /** Digitizes the PDFs an admin uploaded for the given rows (`ulbId` required). Skips rows with no upload or already queued / digitized. */
  @Post('enqueue-afs')
  @HttpCode(HttpStatus.ACCEPTED)
  enqueueAfs(@Body() body: AfsDigitizationV3QueryDto) {
    return this.digitizationV3Service.enqueueAfs(body);
  }
}
