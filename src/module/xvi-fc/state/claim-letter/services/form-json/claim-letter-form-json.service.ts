import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { FormJsonService } from 'src/master/form-json/form-json.service';
import type { FieldConfig } from 'src/module/xvi-fc/common/types/field-config.type';
import { CLAIM_LETTER_FORM_ID } from '../../constants/claim-letter.constants';
import {
  CLAIM_LETTER_VARIANCE_LOWER_META_KEY,
  CLAIM_LETTER_VARIANCE_LOWER_PERCENT,
  CLAIM_LETTER_VARIANCE_UPPER_META_KEY,
  CLAIM_LETTER_VARIANCE_UPPER_PERCENT,
} from '../../helpers/claim-letter-financial.helpers';

export interface ClaimLetterFormConfig {
  questions: FieldConfig[];
  varianceLowerPercent: number;
  varianceUpperPercent: number;
  /** Letter-detail questions in `meta.letterDetailKeys` order; empty when not configured. */
  letterQuestions: FieldConfig[];
  /** Keys the "Prefill from previous batch" button leaves alone (e.g. Letter No., Letter date). */
  letterSkipPrefill: Set<string>;
  /** False when no valid key is configured: Download and Submit are then blocked. */
  letterConfigured: boolean;
  /** Documents merged after the signed letter into the final claim letter, in order (`meta.mergeDocuments`). */
  mergeDocuments: ClaimLetterMergeDocument[];
}

/** One supporting document of the final PDF: read from form `formId`, first `fileKeys` entry set. */
export interface ClaimLetterMergeDocument {
  label: string;
  formId: number;
  fileKeys: string[];
  optional: boolean;
}

export interface ClaimLetterVarianceConfig {
  lowerPercent: number;
  upperPercent: number;
}

const LETTER_KEYS_META_KEY = 'letterDetailKeys';
const LETTER_SKIP_PREFILL_META_KEY = 'letterDetailSkipPrefill';
const MERGE_DOCUMENTS_META_KEY = 'mergeDocuments';
const SIGNED_FILE_KEY = 'signedClaimFile';

@Injectable()
export class ClaimLetterFormJsonService {
  private readonly logger = new Logger(ClaimLetterFormJsonService.name);

  constructor(private readonly formJsonService: FormJsonService) {}

  /**
   * Loads Claim Letter's own form-json document (formId CLAIM_LETTER_FORM_ID) for a design year
   * exactly once and returns both the field config and the variance band derived from it. Callers
   * that need both must use this rather than chaining a separate variance lookup — that would fetch
   * the same document twice per request. Missing/unseeded is expected before the payload is pushed
   * (same as the old `loadQuestions`), so it degrades to empty questions + default variance with a
   * logged warning rather than throwing.
   */
  async loadFormConfig(yearId: string): Promise<ClaimLetterFormConfig> {
    try {
      const formJson = await this.formJsonService.findActiveByDesignYearAndFormId(yearId, CLAIM_LETTER_FORM_ID);
      const questions = formJson.data ?? [];
      const letterQuestions = this.resolveLetterQuestions(questions, formJson.meta);
      return {
        questions,
        varianceLowerPercent: this.resolvePercent(
          formJson.meta,
          CLAIM_LETTER_VARIANCE_LOWER_META_KEY,
          CLAIM_LETTER_VARIANCE_LOWER_PERCENT,
        ),
        varianceUpperPercent: this.resolvePercent(
          formJson.meta,
          CLAIM_LETTER_VARIANCE_UPPER_META_KEY,
          CLAIM_LETTER_VARIANCE_UPPER_PERCENT,
        ),
        letterQuestions,
        letterSkipPrefill: this.resolveStringSet(formJson.meta?.[LETTER_SKIP_PREFILL_META_KEY]),
        letterConfigured: letterQuestions.length > 0,
        mergeDocuments: this.resolveMergeDocuments(formJson.meta?.[MERGE_DOCUMENTS_META_KEY]),
      };
    } catch (err) {
      if (err instanceof NotFoundException) {
        this.logger.warn(`Claim Letter formjsons (formId ${CLAIM_LETTER_FORM_ID}) not seeded for year ${yearId}.`);
        return {
          questions: [],
          varianceLowerPercent: CLAIM_LETTER_VARIANCE_LOWER_PERCENT,
          varianceUpperPercent: CLAIM_LETTER_VARIANCE_UPPER_PERCENT,
          letterQuestions: [],
          letterSkipPrefill: new Set(),
          letterConfigured: false,
          mergeDocuments: [],
        };
      }
      throw err;
    }
  }

  /** Convenience wrapper over loadFormConfig for callers that only need the variance band. */
  async loadVarianceConfig(yearId: string): Promise<ClaimLetterVarianceConfig> {
    const { varianceLowerPercent, varianceUpperPercent } = await this.loadFormConfig(yearId);
    return { lowerPercent: varianceLowerPercent, upperPercent: varianceUpperPercent };
  }

  private resolvePercent(meta: Record<string, unknown> | undefined, key: string, fallback: number): number {
    const raw = meta?.[key];
    return typeof raw === 'number' && Number.isFinite(raw) && raw >= 0 ? raw : fallback;
  }

  /** A listed key must be unique, have a question and not be the signed file; bad keys are logged
   *  and skipped. */
  private resolveLetterQuestions(questions: FieldConfig[], meta: Record<string, unknown> | undefined): FieldConfig[] {
    const raw = meta?.[LETTER_KEYS_META_KEY];
    if (raw === undefined) return [];
    if (!Array.isArray(raw)) {
      this.logger.warn(`Claim letter meta.${LETTER_KEYS_META_KEY} is not an array; letter details disabled.`);
      return [];
    }

    const questionByKey = new Map(questions.map((q) => [q.key, q]));
    const seen = new Set<string>();
    const letterQuestions: FieldConfig[] = [];
    for (const key of raw as unknown[]) {
      const question = typeof key === 'string' ? questionByKey.get(key) : undefined;
      if (!question || key === SIGNED_FILE_KEY || seen.has(key as string)) {
        this.logger.warn(`Claim letter letter-detail key skipped (unknown, duplicate or reserved): ${String(key)}`);
        continue;
      }
      seen.add(key as string);
      letterQuestions.push(question);
    }
    return letterQuestions;
  }

  /** Entries need a label, a numeric formId and at least one file key; others are logged and skipped. */
  private resolveMergeDocuments(raw: unknown): ClaimLetterMergeDocument[] {
    if (!Array.isArray(raw)) return [];
    const documents: ClaimLetterMergeDocument[] = [];
    for (const entry of raw as unknown[]) {
      const doc = entry as { label?: unknown; formId?: unknown; fileKeys?: unknown; optional?: unknown };
      const fileKeys = Array.isArray(doc?.fileKeys)
        ? doc.fileKeys.filter((k): k is string => typeof k === 'string')
        : [];
      if (typeof doc?.label !== 'string' || !doc.label.trim() || typeof doc.formId !== 'number' || !fileKeys.length) {
        this.logger.warn(
          `Claim letter merge document skipped (needs label, formId, fileKeys): ${JSON.stringify(entry)}`,
        );
        continue;
      }
      documents.push({ label: doc.label.trim(), formId: doc.formId, fileKeys, optional: doc.optional === true });
    }
    return documents;
  }

  private resolveStringSet(raw: unknown): Set<string> {
    return new Set(Array.isArray(raw) ? raw.filter((v): v is string => typeof v === 'string') : []);
  }
}
