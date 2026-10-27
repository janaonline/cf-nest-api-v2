import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { AFS_DIGITIZATION_V3_QUEUE } from 'src/core/constants/queues';
import { AfsDigitizationV3JobData } from './afs-digitization-v3.constants';
import { AfsDigitizationV3QueueService } from './afs-digitization-v3-queue.service';

// Each job holds a slot while FastAPI works, and FastAPI runs its background tasks with no
// concurrency limit of its own, so this is the cap on parallel FastAPI digitization jobs.
@Processor(AFS_DIGITIZATION_V3_QUEUE, { concurrency: 3 })
export class AfsDigitizationV3Processor extends WorkerHost {
  private readonly logger = new Logger(AfsDigitizationV3Processor.name);

  constructor(private readonly queueService: AfsDigitizationV3QueueService) {
    super();
  }

  async process(job: Job<AfsDigitizationV3JobData>): Promise<void> {
    await this.queueService.handleJob(job);
    this.logger.log(`AFS digitization v3 job ${job.id} completed`);
  }
}
