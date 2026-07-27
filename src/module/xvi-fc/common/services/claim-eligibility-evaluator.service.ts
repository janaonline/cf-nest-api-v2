import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import { Connection, Types } from 'mongoose';
import type { FormStatusType } from 'src/common/constants/form-status.constants';
import type { IFormJson } from 'src/form-json/interfaces/form-json.interface';
import {
  CLAIM_ELIGIBILITY_EVIDENCE_MAX_SERIALIZED_BYTES,
  type EligibilityEvaluationResult,
  type FormStatusEvidenceV1,
} from 'src/module/xvi-fc/common/types/claim-eligibility.type';

export interface ClaimEligibilityEvaluationContext {
  stateId: Types.ObjectId;
  designYearId: string;
  installment: 1 | 2;
}

/**
 * Generic evaluator dispatch (plan §4) — evaluates one enabled `formJson.claimEligibility` source
 * against live data. Only 'FORM_STATUS' is implemented (brain §7.3's named type for "Devolution
 * parent checks"); any other configured `evaluator.type` throws loudly rather than silently
 * passing every ULB. No `formId === 24` (or any other formId) branching anywhere in this file —
 * the source collection/field mapping and installment scoping come entirely from the passed-in
 * `sourceFormJson.claimEligibility` config, so wiring in a second FORM_STATUS-shaped source (e.g.
 * SFC) later is pure configuration.
 */
@Injectable()
export class ClaimEligibilityEvaluatorService {
  constructor(@InjectConnection() private readonly connection: Connection) {}

  async evaluate(
    sourceFormJson: IFormJson,
    ctx: ClaimEligibilityEvaluationContext,
  ): Promise<EligibilityEvaluationResult> {
    const config = sourceFormJson.claimEligibility;
    if (!config?.enabled) {
      throw new InternalServerErrorException(
        `formJson ${String(sourceFormJson._id)} has no enabled claimEligibility config.`,
      );
    }

    switch (config.evaluator.type) {
      case 'FORM_STATUS':
        return this.evaluateFormStatus(sourceFormJson, ctx);
      default:
        throw new InternalServerErrorException(
          `Unsupported claim-eligibility evaluator type: "${config.evaluator.type}".`,
        );
    }
  }

  private async evaluateFormStatus(
    sourceFormJson: IFormJson,
    ctx: ClaimEligibilityEvaluationContext,
  ): Promise<EligibilityEvaluationResult> {
    // Non-null: only called after the `config.enabled` guard in evaluate().
    const config = sourceFormJson.claimEligibility!;
    const { source } = config;

    if (!source.collection || !source.fields) {
      throw new InternalServerErrorException(
        `formJson ${String(sourceFormJson._id)}'s FORM_STATUS evaluator is missing source.collection/source.fields.`,
      );
    }

    const query: Record<string, unknown> = {
      [source.fields.designYear]: new Types.ObjectId(ctx.designYearId),
    };
    if (source.fields.state) query[source.fields.state] = ctx.stateId;

    // Devolution's installment scoping travels through the free-form evaluator config bag —
    // brain §7.2's source.fields mapping has no dedicated `installment` key.
    const installmentField = config.evaluator.config?.['installmentField'];
    if (typeof installmentField === 'string') query[installmentField] = ctx.installment;

    const doc = await this.connection.collection(source.collection).findOne(query);
    const evaluatedAt = new Date().toISOString();
    const acceptedFormStatuses = config.acceptedFormStatuses;

    const base = {
      formId: sourceFormJson.formId ?? 0,
      formJsonId: String(sourceFormJson._id),
      ruleVersion: config.ruleVersion,
      formType: sourceFormJson.type ?? '',
      ownerLevel: config.ownerLevel,
      evaluationLevel: config.evaluationLevel,
    };

    if (!doc) {
      const evidence: FormStatusEvidenceV1 = {
        evidenceVersion: 1,
        resolvedFormStatus: null,
        acceptedFormStatuses,
        sourceFormDocumentId: null,
        evaluatedAt,
      };
      return {
        ...base,
        formDocumentId: null,
        statusAtEvaluation: null,
        result: 'FAILED',
        reasonCode: 'SOURCE_FORM_NOT_FOUND',
        evidence,
      };
    }

    // Cast, not narrowed: this value comes from an external collection at runtime and can't be
    // statically guaranteed to be one of FormStatusType's literal members.
    const resolvedFormStatus = doc[source.fields.currentFormStatus] as FormStatusType;
    const passed = acceptedFormStatuses.includes(resolvedFormStatus);

    const evidence: FormStatusEvidenceV1 = {
      evidenceVersion: 1,
      resolvedFormStatus,
      acceptedFormStatuses,
      sourceFormDocumentId: String(doc['_id']),
      evaluatedAt,
    };
    this.assertEvidenceSize(evidence);

    return {
      ...base,
      formDocumentId: String(doc['_id']),
      statusAtEvaluation: resolvedFormStatus,
      result: passed ? 'PASSED' : 'FAILED',
      reasonCode: passed ? 'FORM_STATUS_ACCEPTED' : `FORM_STATUS_${resolvedFormStatus}_NOT_ACCEPTED`,
      evidence,
    };
  }

  /** One misconfigured future evaluator can't inflate child-document size across a 700-ULB batch. */
  private assertEvidenceSize(evidence: FormStatusEvidenceV1): void {
    const size = Buffer.byteLength(JSON.stringify(evidence), 'utf8');
    if (size > CLAIM_ELIGIBILITY_EVIDENCE_MAX_SERIALIZED_BYTES) {
      throw new InternalServerErrorException(
        `Claim-eligibility evidence exceeds the ${CLAIM_ELIGIBILITY_EVIDENCE_MAX_SERIALIZED_BYTES}-byte limit.`,
      );
    }
  }
}
