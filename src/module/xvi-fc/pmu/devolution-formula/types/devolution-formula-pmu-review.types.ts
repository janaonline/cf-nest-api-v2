import type { Types } from 'mongoose';
import type { DfInstallment } from 'src/module/xvi-fc/state/devolution-formula/constants/devolution-formula.constants';
import type { XvifcFormActor } from 'src/module/xvi-fc/common/types/xvifc-form-actors.type';
import type { PmuReviewPermissions } from 'src/module/xvi-fc/common/types/pmu-review-permissions.type';

/** Lean form projection read/written by the PMU review service. No `data` snapshot field (unlike
 *  SFC's/GTC's own `*PmuFormLean`) — see CLAUDE.md's "Read-only row access" section. */
export interface DevolutionFormulaPmuFormLean {
  _id: Types.ObjectId;
  state: Types.ObjectId;
  year: Types.ObjectId;
  installment: DfInstallment;
  currentFormStatus: number;
  activeDatasetVersion: number;
}

export type DevolutionFormulaPmuReviewPermissions = PmuReviewPermissions;

export interface DevolutionFormulaPmuReviewData {
  formId: string;
  stateId: string;
  stateName: string;
  yearId: string;
  installment: DfInstallment;
  currentFormStatus: number;
  currentFormStatusLabel: string;
  /** Set on PMU reject, never cleared until the next transition overwrites it. */
  pmuRemarks: string | null;
  permissions: DevolutionFormulaPmuReviewPermissions;
  actors: XvifcFormActor[];
}

export interface DevolutionFormulaPmuSubmitData {
  currentFormStatus: number;
  currentFormStatusLabel: string;
}

/** Read-only — see CLAUDE.md's "Read-only row access" section. Mirrors the columns
 *  `devolution-formula-rows-dialog.component.html` (State's own read side) already shows. */
export interface DevolutionFormulaPmuRow {
  rowNumber: number;
  censusCode: string;
  ulbName: string;
  totalGrantAllocation: number;
  installment1Amount: number;
  installment2Amount: number;
  devolutionFormula: string;
}

export interface DevolutionFormulaPmuRowsData {
  rows: DevolutionFormulaPmuRow[];
}
