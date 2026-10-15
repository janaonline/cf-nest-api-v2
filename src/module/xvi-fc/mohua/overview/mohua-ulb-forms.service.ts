import { Injectable } from '@nestjs/common';
import { getFormStatusLabel } from 'src/common/constants/form-status.constants';
import { MohuaOverviewUlbProgressService, type UlbFormStatusCodes } from './mohua-overview-ulb-progress.service';
import {
  MOHUA_OVERVIEW_SLB_SUBMITTED_STATUSES,
  MOHUA_OVERVIEW_ULB_SUBMITTED_STATUSES,
} from './mohua-overview.constants';
import type { MohuaUlbFormStatus, MohuaUlbForms } from './mohua-ulb-forms.types';

const NOT_STARTED_LABEL = 'Not started';

/**
 * One ULB's five forms as MoHUA needs to show them: the status text and whether the ULB has submitted
 * the form to the State. The submitted rule lives here only, so the UI never keeps its own copy.
 */
@Injectable()
export class MohuaUlbFormsService {
  constructor(private readonly ulbProgressService: MohuaOverviewUlbProgressService) {}

  async get(ulbId: string, yearId: string): Promise<MohuaUlbForms> {
    const codes = await this.ulbProgressService.loadUlbFormStatuses(yearId, ulbId);

    const status = (key: keyof UlbFormStatusCodes, submittedStatuses: ReadonlySet<number>): MohuaUlbFormStatus => {
      const statusCode = codes[key];
      return {
        statusCode,
        statusLabel: statusCode === null ? NOT_STARTED_LABEL : getFormStatusLabel(statusCode),
        submitted: statusCode !== null && submittedStatuses.has(statusCode),
      };
    };

    return {
      forms: {
        audited: status('audited', MOHUA_OVERVIEW_ULB_SUBMITTED_STATUSES),
        unaudited: status('unaudited', MOHUA_OVERVIEW_ULB_SUBMITTED_STATUSES),
        pfms: status('pfms', MOHUA_OVERVIEW_ULB_SUBMITTED_STATUSES),
        slb: status('slb', MOHUA_OVERVIEW_SLB_SUBMITTED_STATUSES),
        dur: status('dur', MOHUA_OVERVIEW_ULB_SUBMITTED_STATUSES),
      },
    };
  }
}
