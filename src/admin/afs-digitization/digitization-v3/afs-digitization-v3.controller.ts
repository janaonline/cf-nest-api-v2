import { BadRequestException, Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query, UseGuards } from '@nestjs/common';
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

  /**
   * to be removed once the FastAPI backfill is complete and the scores are stored in the DB.
   * One-off backfill: copies scores from FastAPI's job records (`afs-digitization-jobs`) for files digitized before scores were stored.
   * Handles up to `limit` files per call (default 500); call again until `candidates` is 0.
   */
  @Post('scores/backfill')
  @Public()
  @HttpCode(HttpStatus.OK)
  async backfillScores(@Query('limit') limit?: string, @Query('since') since?: string) {
    const n = Math.min(Math.max(Number(limit) || 500, 1), 2000);
    // `since` (e.g. 2026-10-01): only files digitized on or after that date
    const sinceDate = since ? new Date(since) : undefined;
    if (sinceDate && Number.isNaN(sinceDate.getTime())) throw new BadRequestException('since must be a valid date');
    return { success: true, data: await this.digitizationV3Service.backfillScoresFromJobs(n, sinceDate) };
  }

  /**
   * Backfill for jobs the files are not linked to by `requestId`: matches each job in `afs-digitization-jobs` to a
   * file by its ULB name, financial year and doc type, and copies the scores onto a single digitized file that has
   * none. Never creates files. A dry run by default: pass `dryRun=false` to write.
   */
  @Post('scores/backfill-by-match')
  @Public()
  @HttpCode(HttpStatus.OK)
  async backfillScoresByMatch(@Query('dryRun') dryRun?: string, @Query('limit') limit?: string) {
    const n = Math.min(Math.max(Number(limit) || 1000, 1), 5000);
    return { success: true, data: await this.digitizationV3Service.backfillScoresByMatch(dryRun !== 'false', n) };
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
