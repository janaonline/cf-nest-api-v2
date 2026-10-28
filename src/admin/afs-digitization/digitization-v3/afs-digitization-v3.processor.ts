import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Job } from 'bullmq';
import { AFS_DIGITIZATION_V3_QUEUE } from 'src/core/constants/queues';
import { AfsDigitizationV3JobData } from './afs-digitization-v3.constants';
import { AfsDigitizationV3QueueService } from './afs-digitization-v3-queue.service';

const DEFAULT_CONCURRENCY = 3;
// The run window is always read in IST, whatever timezone the server is set to
const RUN_WINDOW_TIMEZONE = 'Asia/Kolkata';
const WINDOW_CHECK_INTERVAL_MS = 60_000;

// Each job holds a slot while FastAPI works, and FastAPI runs its background tasks with no
// concurrency limit of its own, so this is the cap on parallel FastAPI digitization jobs.
// The real value is set from AFS_DIGITIZATION_V3_CONCURRENCY once the worker exists (see onApplicationBootstrap).
//
// AFS_DIGITIZATION_V3_RUN_WINDOW ("HH:mm-HH:mm", e.g. "22:00-06:00") limits when jobs are picked up, in
// Asia/Kolkata time. Empty means always. Outside the window the
// worker is paused: waiting jobs stay in the queue, and jobs already running are allowed to finish.
@Processor(AFS_DIGITIZATION_V3_QUEUE, { concurrency: DEFAULT_CONCURRENCY })
export class AfsDigitizationV3Processor extends WorkerHost implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(AfsDigitizationV3Processor.name);
  private windowTimer?: NodeJS.Timeout;
  private paused = false;

  constructor(
    private readonly queueService: AfsDigitizationV3QueueService,
    private readonly config: ConfigService,
  ) {
    super();
  }

  // Runs after every module is initialised, so the BullMQ worker is guaranteed to exist
  onApplicationBootstrap(): void {
    const concurrency = Number(this.config.get('AFS_DIGITIZATION_V3_CONCURRENCY'));
    this.worker.concurrency = Number.isInteger(concurrency) && concurrency > 0 ? concurrency : DEFAULT_CONCURRENCY;

    const window = this.parseWindow(this.config.get<string>('AFS_DIGITIZATION_V3_RUN_WINDOW'));
    this.logger.log(
      `AFS digitization v3 worker: concurrency ${this.worker.concurrency}, ` +
        (window ? `run window ${window.label} (${window.timeZone})` : 'no run window (always on)'),
    );
    if (!window) return;

    void this.applyWindow(window);
    this.windowTimer = setInterval(() => void this.applyWindow(window), WINDOW_CHECK_INTERVAL_MS);
  }

  onModuleDestroy(): void {
    if (this.windowTimer) clearInterval(this.windowTimer);
  }

  async process(job: Job<AfsDigitizationV3JobData>): Promise<void> {
    await this.queueService.handleJob(job);
    this.logger.log(`AFS digitization v3 job ${job.id} completed`);
  }

  /** Pauses the worker outside the run window and resumes it inside; running jobs are not interrupted. */
  private async applyWindow(window: RunWindow): Promise<void> {
    try {
      const open = this.isOpen(window);
      if (open && this.paused) {
        this.worker.resume();
        this.paused = false;
        this.logger.log(`AFS digitization v3 worker resumed: inside run window ${window.label}`);
      } else if (!open && !this.paused) {
        await this.worker.pause(true); // true: do not wait for running jobs
        this.paused = true;
        this.logger.log(`AFS digitization v3 worker paused: outside run window ${window.label}`);
      }
    } catch (error) {
      this.logger.error(
        'Could not apply the AFS digitization v3 run window',
        error instanceof Error ? error.stack : String(error),
      );
    }
  }

  private parseWindow(value?: string): RunWindow | null {
    const match = value?.trim().match(/^(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})$/);
    if (!match) {
      if (value?.trim()) this.logger.warn(`Ignoring AFS_DIGITIZATION_V3_RUN_WINDOW "${value}": expected "HH:mm-HH:mm"`);
      return null;
    }

    const start = Number(match[1]) * 60 + Number(match[2]);
    const end = Number(match[3]) * 60 + Number(match[4]);
    if (start > 1439 || end > 1439 || start === end) {
      this.logger.warn(`Ignoring AFS_DIGITIZATION_V3_RUN_WINDOW "${value}": invalid or empty range`);
      return null;
    }

    return { start, end, timeZone: RUN_WINDOW_TIMEZONE, label: value!.trim() };
  }

  /** Minutes since midnight in the window's timezone; a window like 22:00-06:00 wraps past midnight. */
  private isOpen({ start, end, timeZone }: RunWindow): boolean {
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone,
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(new Date());
    const hour = Number(parts.find((p) => p.type === 'hour')?.value);
    const minute = Number(parts.find((p) => p.type === 'minute')?.value);
    const now = hour * 60 + minute;
    return start < end ? now >= start && now < end : now >= start || now < end;
  }
}

interface RunWindow {
  start: number;
  end: number;
  timeZone: string;
  label: string;
}
