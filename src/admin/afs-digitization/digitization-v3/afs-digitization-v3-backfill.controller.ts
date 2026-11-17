import { Controller, HttpCode, HttpStatus, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth } from '@nestjs/swagger';
import { Public } from 'src/module/auth/decorators/public.decorator';
import { Roles } from 'src/module/auth/decorators/roles.decorator';
import { Role } from 'src/module/auth/enum/role.enum';
import { RolesGuard } from 'src/module/auth/guards/roles.guard';
import { AfsDigitizationV3Service } from './afs-digitization-v3.service';

/**
 * One-off score backfills and metric rebuilds. The backfills are to be removed once the scores are stored in the DB for every digitized file.
 * Shares the `afs-digitization-v3` prefix with `AfsDigitizationV3Controller`, so the URLs are unchanged.
 */
@ApiBearerAuth()
@UseGuards(RolesGuard)
@Roles([Role.ADMIN, Role.AFS_ADMIN])
@Controller('afs-digitization-v3')
export class AfsDigitizationV3BackfillController {
  constructor(private readonly digitizationV3Service: AfsDigitizationV3Service) {}

  /**
   * Copies scores from FastAPI's job records (`afs-digitization-jobs`) for files digitized before scores were stored.
   * Handles up to `limit` files per call (default 500); call again until `candidates` is 0.
   * Only files with no scores yet by default; pass `force=true` to re-score files that already have them.
   */
  @Post('scores/backfill')
  @Public()
  @HttpCode(HttpStatus.OK)
  async backfillScores(@Query('limit') limit?: string, @Query('force') force?: string) {
    const n = Math.min(Math.max(Number(limit) || 500, 1), 2000);
    return { success: true, data: await this.digitizationV3Service.backfillScoresFromJobs(n, force === 'true') };
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
}
