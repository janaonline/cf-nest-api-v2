import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { XviFcAnnualAccount } from 'src/schemas/xvi-fc/annual-account.schema';
import { XviFcDur } from 'src/schemas/xvi-fc/dur.schema';
import { XviFcBankAccount } from 'src/schemas/xvi-fc/ulb/xvi-fc-bank-account.schema';
import { SlbForm } from 'src/schemas/xvi-fc/ulb/slb-form.schema';
import {
  MOHUA_OVERVIEW_SLB_SUBMITTED_STATUSES,
  MOHUA_OVERVIEW_ULB_SUBMITTED_STATUSES,
} from './mohua-overview.constants';

type LeanUlbStatus = { ulb: Types.ObjectId; currentFormStatus: number };
type LeanAnnualAccountStatus = { ulb: Types.ObjectId; sectionType: string; form_status_id: number };

/** ULB ids (as strings) that have submitted each ULB form, and all five of them. */
export interface SubmittedUlbIdsByForm {
  audited: Set<string>;
  unaudited: Set<string>;
  dur: Set<string>;
  slb: Set<string>;
  pfms: Set<string>;
  /** ULBs that have submitted all five. */
  all: Set<string>;
}

/** One ULB's status code per form; null when it has no record for that form. */
export interface UlbFormStatusCodes {
  audited: number | null;
  unaudited: number | null;
  pfms: number | null;
  slb: number | null;
  dur: number | null;
}

/**
 * Which ULBs have submitted each ULB form (audited, unaudited, DUR, SLB, PFMS bank account) to the
 * State. The cross-state Overview scans the whole year; a single-state caller passes that state's
 * ULB ids so only those ULBs' documents are read (every collection is indexed on `ulb`).
 */
@Injectable()
export class MohuaOverviewUlbProgressService {
  constructor(
    @InjectModel(XviFcAnnualAccount.name) private readonly annualAccountModel: Model<XviFcAnnualAccount>,
    @InjectModel(XviFcDur.name) private readonly durModel: Model<XviFcDur>,
    @InjectModel(SlbForm.name) private readonly slbModel: Model<SlbForm>,
    @InjectModel(XviFcBankAccount.name) private readonly bankAccountModel: Model<XviFcBankAccount>,
  ) {}

  /** The Overview's "ULBs done": ULBs that have submitted all five forms. */
  async loadFullySubmittedUlbIds(yearId: string, ulbIds?: string[]): Promise<Set<string>> {
    return (await this.loadSubmittedUlbIdsByForm(yearId, ulbIds)).all;
  }

  /** `ulbIds` limits the read to those ULBs; omit it to read every ULB for the year. */
  async loadSubmittedUlbIdsByForm(yearId: string, ulbIds?: string[]): Promise<SubmittedUlbIdsByForm> {
    const { annualAccounts, durs, slbs, bankAccounts } = await this.loadRecords(yearId, ulbIds);

    const audited = this.submittedUlbs(
      annualAccounts.filter((a) => a.sectionType === 'audited'),
      (a) => a.form_status_id,
    );
    const unaudited = this.submittedUlbs(
      annualAccounts.filter((a) => a.sectionType === 'unaudited'),
      (a) => a.form_status_id,
    );
    const dur = this.submittedUlbs(durs, (d) => d.currentFormStatus);
    const slb = this.submittedUlbs(slbs, (s) => s.currentFormStatus, MOHUA_OVERVIEW_SLB_SUBMITTED_STATUSES);
    const pfms = this.submittedUlbs(bankAccounts, (b) => b.currentFormStatus);

    const all = new Set([...audited].filter((id) => unaudited.has(id) && dur.has(id) && slb.has(id) && pfms.has(id)));
    return { audited, unaudited, dur, slb, pfms, all };
  }

  /**
   * One ULB's status per form. Where a form has several records (the PFMS account may sit in an
   * earlier year as well as this one) a submitted one wins, so the ULB is not shown as unsubmitted
   * while it actually has submitted.
   */
  async loadUlbFormStatuses(yearId: string, ulbId: string): Promise<UlbFormStatusCodes> {
    const { annualAccounts, durs, slbs, bankAccounts } = await this.loadRecords(yearId, [ulbId]);

    const pick = (statuses: number[], submitted: ReadonlySet<number> = MOHUA_OVERVIEW_ULB_SUBMITTED_STATUSES) =>
      statuses.find((status) => submitted.has(status)) ?? statuses[0] ?? null;
    const annual = (section: 'audited' | 'unaudited') =>
      annualAccounts.filter((a) => a.sectionType === section).map((a) => a.form_status_id);

    return {
      audited: pick(annual('audited')),
      unaudited: pick(annual('unaudited')),
      pfms: pick(bankAccounts.map((b) => b.currentFormStatus)),
      slb: pick(
        slbs.map((s) => s.currentFormStatus),
        MOHUA_OVERVIEW_SLB_SUBMITTED_STATUSES,
      ),
      dur: pick(durs.map((d) => d.currentFormStatus)),
    };
  }

  private async loadRecords(yearId: string, ulbIds?: string[]) {
    const yearOid = new Types.ObjectId(yearId);
    const ulbScope = ulbIds ? { ulb: { $in: ulbIds.map((id) => new Types.ObjectId(id)) } } : {};

    const [annualAccounts, durs, slbs, bankAccounts] = await Promise.all([
      this.annualAccountModel
        .find({ ...ulbScope, design_year: yearOid })
        .select('ulb sectionType form_status_id')
        .lean<LeanAnnualAccountStatus[]>()
        .exec(),
      this.durModel
        .find({ ...ulbScope, design_year: yearOid })
        .select('ulb currentFormStatus')
        .lean<LeanUlbStatus[]>()
        .exec(),
      this.slbModel
        .find({ ...ulbScope, year: yearOid, isDeleted: { $ne: true } })
        .select('ulb currentFormStatus')
        .lean<LeanUlbStatus[]>()
        .exec(),
      // PFMS is submitted once and reused across years (ONCE_EVER), so its record may sit in an earlier year.
      this.bankAccountModel
        .find({ ...ulbScope, $or: [{ designYear: yearOid }, { submissionScope: 'ONCE_EVER' }] })
        .select('ulb currentFormStatus')
        .lean<LeanUlbStatus[]>()
        .exec(),
    ]);

    return { annualAccounts, durs, slbs, bankAccounts };
  }

  /** ULB ids that have at least one record in one of the `submitted` statuses. */
  private submittedUlbs<T extends { ulb: Types.ObjectId }>(
    records: T[],
    statusOf: (record: T) => number,
    submitted: ReadonlySet<number> = MOHUA_OVERVIEW_ULB_SUBMITTED_STATUSES,
  ): Set<string> {
    return new Set(records.filter((r) => submitted.has(statusOf(r))).map((r) => String(r.ulb)));
  }
}
