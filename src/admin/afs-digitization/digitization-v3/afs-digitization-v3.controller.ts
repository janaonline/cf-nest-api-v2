import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth } from '@nestjs/swagger';
import { Roles } from 'src/module/auth/decorators/roles.decorator';
import { Role } from 'src/module/auth/enum/role.enum';
import { RolesGuard } from 'src/module/auth/guards/roles.guard';
import { AfsDigitizationV3QueryDto } from '../dto/afs-digitization-v3-query.dto';
import { AfsDigitizationV3QueueService } from './afs-digitization-v3-queue.service';
import { AfsDigitizationV3Service } from './afs-digitization-v3.service';

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
}
