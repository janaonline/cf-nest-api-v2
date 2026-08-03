import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';
import type {
  ClaimEligibilityEvaluationLevel,
  ClaimEligibilityOwnerLevel,
  ClaimEligibilityYearScope,
  ClaimEvaluationType,
  ClaimWorkflowAction,
} from 'src/module/xvi-fc/common/types/claim-eligibility.type';

const CLAIM_EVALUATION_TYPES: ClaimEvaluationType[] = [
  'FORM_STATUS',
  'FORM_AND_ROW_STATUS',
  'ROW_STATUS_AND_FIELDS',
  'BRANCH_WITH_OPTIONAL_ROWS',
  'ONE_TIME_FORM_STATUS',
];

const CLAIM_WORKFLOW_ACTIONS: ClaimWorkflowAction[] = [
  'NO_ACTION',
  'SET_FORM_STATUS',
  'SET_ROW_STATUS',
  'MARK_DEPENDENT_ROWS_NEEDS_UPDATE',
  'INVALIDATE_CLAIM_DRAFTS',
];

/**
 * `formJson.claimEligibility` validated shape (brain §7.2-§7.4). The Mongoose schema itself
 * stores this loosely as `Object` (same treatment as the pre-existing `data`/`meta` fields) —
 * this DTO is where brain §3.3's "schema-validated enums, controlled comparison operators,
 * allowlisted workflow actions; never arbitrary JavaScript/operators" is actually enforced, on
 * every admin write to the formjsons collection.
 */
export class ClaimEligibilitySourceFieldMappingDto {
  @IsString()
  designYear!: string;

  @IsOptional()
  @IsString()
  state?: string;

  @IsOptional()
  @IsString()
  ulb?: string;

  @IsString()
  currentFormStatus!: string;

  @IsOptional()
  @IsString()
  isActive?: string;

  @IsOptional()
  @IsString()
  revision?: string;

  @IsOptional()
  @IsString()
  datasetVersion?: string;
}

export class ClaimEligibilitySourceDto {
  @IsOptional()
  @IsString()
  collection?: string;

  @IsOptional()
  @IsString()
  parentCollection?: string;

  @IsOptional()
  @IsString()
  rowCollection?: string;

  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => ClaimEligibilitySourceFieldMappingDto)
  fields?: ClaimEligibilitySourceFieldMappingDto;

  @IsOptional()
  @IsObject()
  parentFields?: Record<string, string>;

  @IsOptional()
  @IsObject()
  rowFields?: Record<string, string>;
}

export class ClaimEligibilityEvaluatorConfigDto {
  @IsIn(CLAIM_EVALUATION_TYPES)
  type!: ClaimEvaluationType;

  // Free-form per-evaluator config bag (e.g. FORM_STATUS's `installmentField`) — deliberately not
  // further constrained here; each evaluator implementation validates the keys it actually reads.
  @IsOptional()
  @IsObject()
  config?: Record<string, unknown>;
}

export class ClaimEligibilityExemptionConfigDto {
  @IsBoolean()
  allowed!: boolean;

  @IsOptional()
  @IsIn(['FORM_STATUS', 'ROW_ELIGIBILITY'])
  targetLevel?: 'FORM_STATUS' | 'ROW_ELIGIBILITY';
}

export class ClaimWorkflowActionConfigDto {
  @IsIn(CLAIM_WORKFLOW_ACTIONS)
  action!: ClaimWorkflowAction;

  @IsOptional()
  @IsInt()
  targetFormStatus?: number;

  @IsOptional()
  @IsInt()
  targetRowStatus?: number;
}

export class ClaimEligibilityConfigDto {
  @IsBoolean()
  enabled!: boolean;

  @IsInt()
  ruleVersion!: number;

  @IsOptional()
  @IsString()
  displayLabel?: string;

  @IsOptional()
  @IsString()
  displayDescription?: string;

  @IsOptional()
  @IsString()
  shortLabel?: string;

  @IsIn(['STATE', 'ULB'] as ClaimEligibilityOwnerLevel[])
  ownerLevel!: ClaimEligibilityOwnerLevel;

  @IsIn(['FORM', 'ROW', 'FORM_AND_ROW'] as ClaimEligibilityEvaluationLevel[])
  evaluationLevel!: ClaimEligibilityEvaluationLevel;

  @IsIn(['CURRENT_DESIGN_YEAR', 'SUBMISSION_PERIOD_SINGLETON'] as ClaimEligibilityYearScope[])
  yearScope!: ClaimEligibilityYearScope;

  @IsArray()
  @IsIn([1, 2], { each: true })
  applicableInstallments!: (1 | 2)[];

  @IsArray()
  @IsNumber({}, { each: true })
  acceptedFormStatuses!: number[];

  @IsOptional()
  @IsArray()
  @IsNumber({}, { each: true })
  acceptedRowStatuses?: number[];

  @IsObject()
  @ValidateNested()
  @Type(() => ClaimEligibilitySourceDto)
  source!: ClaimEligibilitySourceDto;

  @IsObject()
  @ValidateNested()
  @Type(() => ClaimEligibilityEvaluatorConfigDto)
  evaluator!: ClaimEligibilityEvaluatorConfigDto;

  @IsObject()
  @ValidateNested()
  @Type(() => ClaimEligibilityExemptionConfigDto)
  exemption!: ClaimEligibilityExemptionConfigDto;

  @IsObject()
  @ValidateNested()
  @Type(() => ClaimWorkflowActionConfigDto)
  approval!: ClaimWorkflowActionConfigDto;

  @IsObject()
  @ValidateNested()
  @Type(() => ClaimWorkflowActionConfigDto)
  rejection!: ClaimWorkflowActionConfigDto;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ClaimWorkflowActionConfigDto)
  dependentActions?: ClaimWorkflowActionConfigDto[];
}
