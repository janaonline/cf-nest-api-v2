import { ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import type { AuthUser } from 'src/module/auth/auth-user.interface';
import { RedisService } from 'src/core/services/redis/redis.service';
import { xviFcSuccess } from 'src/module/xvi-fc/common/response/xvi-fc-response.util';
import type { XviFcApiResponse } from 'src/module/xvi-fc/common/response/xvi-fc-api-response';
import { ExemptionResolverService } from 'src/module/xvi-fc/common/services/exemption-resolver.service';
import { ExpectedUlbSetService } from 'src/module/xvi-fc/common/services/expected-ulb-set.service';
import { FORM_STATUS } from 'src/common/constants/form-status.constants';
import type { FieldConfig } from 'src/module/xvi-fc/common/types/field-config.type';
import { assertStateAccess } from 'src/module/xvi-fc/common/utils/xvi-fc-state-access.util';
import {
  formatHalfRupeesInLakh,
  formatRupeesInLakh,
  rupeesToIndianWords,
} from 'src/module/xvi-fc/common/utils/xvi-fc-amount-format.util';
import { ClaimLetterBatch, ClaimLetterBatchDocument } from 'src/schemas/xvi-fc/state/claim-letter-batch.schema';
import {
  ClaimLetterBatchUlb,
  ClaimLetterBatchUlbDocument,
} from 'src/schemas/xvi-fc/state/claim-letter-batch-ulb.schema';
import { State, StateDocument } from 'src/schemas/state.schema';
import { Year, YearDocument } from 'src/schemas/year.schema';
import {
  FC_UNSPENT_STATE_FORM_TYPE,
  XviFcUnspentStateForm,
  XviFcUnspentStateFormDocument,
} from 'src/schemas/xvi-fc/state/fc-unspent-state-form.schema';
import {
  XviFcUnspentStateFormRow,
  XviFcUnspentStateFormRowDocument,
} from 'src/schemas/xvi-fc/state/fc-unspent-state-form-row.schema';
import {
  SFC_STATUS_FORM_TYPE,
  XviFcSfcStatus,
  XviFcSfcStatusDocument,
} from 'src/schemas/xvi-fc/state/sfc-status.schema';
import {
  CLAIM_LETTER_ABANDONED_MESSAGE,
  CLAIM_LETTER_DETAIL_PLACEHOLDERS,
  CLAIM_LETTER_DOCUMENT_CACHE_CHUNK_ROWS,
  CLAIM_LETTER_DOCUMENT_CACHE_TTL_SECONDS,
  CLAIM_LETTER_DOCUMENT_PAGE_SIZE,
  CLAIM_LETTER_ROW_CRITERIA,
  CLAIM_LETTER_SIXTH_SCHEDULE_VALUE,
  type ClaimLetterDetailKey,
} from '../../constants/claim-letter.constants';
import { buildClaimLetterRefNo, sumAmountsExactly } from '../../helpers/claim-letter-financial.helpers';
import { resolveSfcExemptionStatus } from '../../helpers/claim-letter-sfc-exemption.helpers';
import {
  b,
  buildAnnexureCell,
  criterionColumn,
  FC_UNSPENT_CRITERION_TYPE,
  formatDetailValue,
  formatFraction,
  formatFractionOrNil,
  formatIstDateTime,
  formatPercent,
  ordinal,
  para,
  ph,
  plural,
  previousInstallmentLabel,
  shiftFinancialYear,
  slotRun,
  t,
  TIED_COLUMN,
  UNTIED_COLUMN,
} from '../../helpers/claim-letter-letter.helpers';
import { ClaimLetterEligibilityService } from '../eligibility/claim-letter-eligibility.service';
import { ClaimLetterFormJsonService } from '../form-json/claim-letter-form-json.service';
import { ClaimLetterActiveBatchService } from '../active-batch/claim-letter-active-batch.service';
import type {
  ClaimLetterAnnexure,
  ClaimLetterAnnexureRow,
  ClaimLetterColumn,
  ClaimLetterComplianceRow,
  ClaimLetterCoveringLetter,
  ClaimLetterDocument,
  ClaimLetterDocumentCounts,
  ClaimLetterFullDocument,
  ClaimLetterListKey,
  ClaimLetterListMeta,
  ClaimLetterRun,
} from '../../types/claim-letter-document.types';

/** The parent fields the letter reads. */
export interface ClaimLetterDocumentParent {
  _id: Types.ObjectId;
  state: Types.ObjectId;
  year: Types.ObjectId;
  installment: 1 | 2;
  batchNumber: number;
  revision: number;
  currentFormStatus: number;
  isAbandoned: boolean;
  letterDetails?: Record<string, unknown>;
}

/** Everything that depends on eligibility and the batch's ULBs except the rows (the cached `meta`). */
interface ClaimLetterAnnexureMeta {
  stateName: string;
  designYearLabel: string;
  refNo: string;
  asOn: string;
  totalClaim: number;
  columns: ClaimLetterColumn[];
  lists: ClaimLetterListMeta[];
  counts: ClaimLetterDocumentCounts;
  rowsCToK: ClaimLetterComplianceRow[];
}

/** A build: the meta plus every row (cached in chunks of `CLAIM_LETTER_DOCUMENT_CACHE_CHUNK_ROWS`). */
interface ClaimLetterAnnexureBuild extends ClaimLetterAnnexureMeta {
  rowsByList: Record<ClaimLetterListKey, ClaimLetterAnnexureRow[]>;
}

/** Row chunks outlive their meta, so a reader that finds the meta always finds its chunks. */
const CHUNK_TTL_GRACE_SECONDS = 30;

interface SfcLetterValues {
  whichAwardPeriod: string | null;
  awardPeriod: string | null;
  /** The Entire State SFC exemption when it counts (5 under MoHUA review, 7 approved); Row B then
   *  prints it instead of the SFC details. */
  exemptionStatus: number | null;
}

const SFC_HINT = 'Comes from the SFC form';

const LIST_TEXT: Record<ClaimLetterListKey, Pick<ClaimLetterListMeta, 'heading' | 'subheading'>> = {
  ELIGIBLE: { heading: '1. List of Eligible ULBs', subheading: 'ULBs in this proposal.' },
  INELIGIBLE: {
    heading: '2. List of Ineligible ULBs',
    subheading: 'All ULBs of the State not yet eligible, for record.',
  },
};

/** One letter model for the preview and the .docx; caching rules in the module CLAUDE.md. */
@Injectable()
export class ClaimLetterDocumentService {
  private readonly logger = new Logger(ClaimLetterDocumentService.name);
  private readonly env: string;
  /** One build per claim + revision at a time; concurrent cache misses share it (this process). */
  private readonly building = new Map<string, Promise<ClaimLetterAnnexureBuild>>();

  constructor(
    private readonly eligibilityService: ClaimLetterEligibilityService,
    private readonly expectedUlbSetService: ExpectedUlbSetService,
    private readonly formJsonConfigService: ClaimLetterFormJsonService,
    private readonly activeBatchService: ClaimLetterActiveBatchService,
    private readonly redis: RedisService,
    private readonly exemptionResolver: ExemptionResolverService,
    config: ConfigService,
    @InjectModel(ClaimLetterBatch.name) private readonly batchModel: Model<ClaimLetterBatchDocument>,
    @InjectModel(ClaimLetterBatchUlb.name) private readonly batchUlbModel: Model<ClaimLetterBatchUlbDocument>,
    @InjectModel(State.name) private readonly stateModel: Model<StateDocument>,
    @InjectModel(Year.name) private readonly yearModel: Model<YearDocument>,
    @InjectModel(XviFcUnspentStateForm.name)
    private readonly unspentFormModel: Model<XviFcUnspentStateFormDocument>,
    @InjectModel(XviFcUnspentStateFormRow.name)
    private readonly unspentRowModel: Model<XviFcUnspentStateFormRowDocument>,
    @InjectModel(XviFcSfcStatus.name) private readonly sfcModel: Model<XviFcSfcStatusDocument>,
  ) {
    this.env = config.get<string>('NODE_ENV') ?? 'production';
  }

  async getDocument(claimLetterId: string, user: AuthUser): Promise<XviFcApiResponse<ClaimLetterDocument>> {
    const parent = await this.loadParent(claimLetterId, user);
    const [annexure, light] = await Promise.all([this.getAnnexureMeta(parent), this.loadLightInputs(parent)]);
    return xviFcSuccess('Claim letter document fetched.', this.assemble(parent, annexure, light.sfc, light.questions));
  }

  async getDocumentUlbs(
    claimLetterId: string,
    list: ClaimLetterListKey,
    page: number,
    user: AuthUser,
  ): Promise<XviFcApiResponse<ClaimLetterAnnexureRow[]>> {
    const parent = await this.loadParent(claimLetterId, user);
    const { rows, total } = await this.getPageRows(parent, list, page);
    return xviFcSuccess('Claim letter ULBs fetched.', rows, { page, limit: CLAIM_LETTER_DOCUMENT_PAGE_SIZE, total });
  }

  /** The full letter for the .docx - always built fresh, never from the preview cache. */
  async buildFullDocument(parent: ClaimLetterDocumentParent): Promise<ClaimLetterFullDocument> {
    const [annexure, light] = await Promise.all([this.buildAnnexure(parent), this.loadLightInputs(parent)]);
    return { ...this.assemble(parent, annexure, light.sfc, light.questions), rowsByList: annexure.rowsByList };
  }

  async loadParent(claimLetterId: string, user: AuthUser): Promise<ClaimLetterDocumentParent> {
    const parent = await this.batchModel
      .findOne({ _id: claimLetterId, assemblyStatus: 'READY' })
      .select('state year installment batchNumber revision currentFormStatus isAbandoned letterDetails')
      .lean<ClaimLetterDocumentParent>()
      .exec();
    if (!parent) throw new NotFoundException(`Claim letter ${claimLetterId} not found`);
    assertStateAccess(user, String(parent.state));
    if (parent.isAbandoned) throw new ConflictException(CLAIM_LETTER_ABANDONED_MESSAGE);
    await this.activeBatchService.assertActive(parent);
    return parent;
  }

  // ─── Heavy part: eligibility, counts, lists ────────────────────────────────

  /** `{base}:meta` and `{base}:{list}:{chunk}`; a revision bump starts new keys, old ones expire. */
  private cacheKey(parent: ClaimLetterDocumentParent): string {
    return `claimLetterDocument:${this.env}:${String(parent._id)}:${parent.revision}`;
  }

  private async getAnnexureMeta(parent: ClaimLetterDocumentParent): Promise<ClaimLetterAnnexureMeta> {
    const base = this.cacheKey(parent);
    const cached = await this.redis.get(`${base}:meta`);
    if (cached !== null) return JSON.parse(cached) as ClaimLetterAnnexureMeta;
    return this.buildAndCache(parent, base);
  }

  /** One page: the meta for the list total and the one chunk that holds the page. */
  private async getPageRows(
    parent: ClaimLetterDocumentParent,
    list: ClaimLetterListKey,
    page: number,
  ): Promise<{ rows: ClaimLetterAnnexureRow[]; total: number }> {
    const base = this.cacheKey(parent);
    const start = (page - 1) * CLAIM_LETTER_DOCUMENT_PAGE_SIZE;
    const chunk = Math.floor(start / CLAIM_LETTER_DOCUMENT_CACHE_CHUNK_ROWS);
    const [meta, chunkJson] = await Promise.all([
      this.redis.get(`${base}:meta`),
      this.redis.get(`${base}:${list}:${chunk}`),
    ]);
    if (meta !== null) {
      const total = (JSON.parse(meta) as ClaimLetterAnnexureMeta).lists.find((l) => l.key === list)?.total ?? 0;
      // No chunk under a present meta: the page is past the end of the list.
      const rows = chunkJson === null ? [] : (JSON.parse(chunkJson) as ClaimLetterAnnexureRow[]);
      const offset = start - chunk * CLAIM_LETTER_DOCUMENT_CACHE_CHUNK_ROWS;
      return { rows: rows.slice(offset, offset + CLAIM_LETTER_DOCUMENT_PAGE_SIZE), total };
    }
    const built = await this.buildAndCache(parent, base);
    const rows = built.rowsByList[list];
    return { rows: rows.slice(start, start + CLAIM_LETTER_DOCUMENT_PAGE_SIZE), total: rows.length };
  }

  private buildAndCache(parent: ClaimLetterDocumentParent, base: string): Promise<ClaimLetterAnnexureBuild> {
    let build = this.building.get(base);
    if (!build) {
      build = this.buildAndStore(parent, base).finally(() => this.building.delete(base));
      this.building.set(base, build);
    }
    return build;
  }

  /** Chunks first, meta last (and chunks live longer), so the meta never points at a missing chunk. */
  private async buildAndStore(parent: ClaimLetterDocumentParent, base: string): Promise<ClaimLetterAnnexureBuild> {
    const startedAt = Date.now();
    const built = await this.buildAnnexure(parent);
    const { rowsByList, ...meta } = built;
    const chunkTtl = CLAIM_LETTER_DOCUMENT_CACHE_TTL_SECONDS + CHUNK_TTL_GRACE_SECONDS;
    const writes: Promise<void>[] = [];
    for (const list of Object.keys(rowsByList) as ClaimLetterListKey[]) {
      const rows = rowsByList[list];
      for (let i = 0; i < rows.length; i += CLAIM_LETTER_DOCUMENT_CACHE_CHUNK_ROWS) {
        const chunk = rows.slice(i, i + CLAIM_LETTER_DOCUMENT_CACHE_CHUNK_ROWS);
        writes.push(
          this.redis.set(
            `${base}:${list}:${i / CLAIM_LETTER_DOCUMENT_CACHE_CHUNK_ROWS}`,
            JSON.stringify(chunk),
            chunkTtl,
          ),
        );
      }
    }
    await Promise.all(writes);
    await this.redis.set(`${base}:meta`, JSON.stringify(meta), CLAIM_LETTER_DOCUMENT_CACHE_TTL_SECONDS);
    this.logger.debug(
      `Annexure ${base}: ${rowsByList.ELIGIBLE.length} + ${rowsByList.INELIGIBLE.length} rows built in ${Date.now() - startedAt} ms`,
    );
    return built;
  }

  private async buildAnnexure(parent: ClaimLetterDocumentParent): Promise<ClaimLetterAnnexureBuild> {
    const stateId = String(parent.state);
    const yearId = String(parent.year);

    const [children, stateDoc, yearDoc, expected, allocations, unspentByUlbId] = await Promise.all([
      this.batchUlbModel
        .find({ claimLetter: parent._id })
        .select('ulbId ulbSnapshot.name claimedAmount')
        .lean<{ ulbId: Types.ObjectId; ulbSnapshot: { name: string }; claimedAmount: number }[]>()
        .exec(),
      this.stateModel.findById(parent.state).select('name code').lean<{ name: string; code: string } | null>().exec(),
      this.yearModel.findById(parent.year).select('year').lean<{ year: string } | null>().exec(),
      this.expectedUlbSetService.resolve(stateId, yearId),
      this.eligibilityService.resolveDevolutionAllocations(stateId, yearId, parent.installment),
      this.resolveUnspentAmounts(parent.state, parent.year),
    ]);
    if (!stateDoc) throw new NotFoundException(`State ${stateId} not found`);
    if (!yearDoc) throw new NotFoundException(`Year ${yearId} not found`);

    const evaluatedAt = new Date();
    const proposal = children
      .map((c) => ({ ulbId: String(c.ulbId), name: c.ulbSnapshot.name, claimedAmount: c.claimedAmount }))
      .sort((x, y) => x.name.localeCompare(y.name));
    const expectedIds = expected.map((u) => u.ulbId);
    const evaluatedIds = [...new Set([...expectedIds, ...proposal.map((p) => p.ulbId)])];

    const eligibility = await this.eligibilityService.resolveUlbLevelEligibility(
      stateId,
      yearId,
      parent.installment,
      evaluatedIds,
    );
    const criteria = eligibility.perCriterion;
    const byType = new Map(criteria.map((c) => [c.type, c]));

    const columns: ClaimLetterColumn[] = [
      { header: 'S. No.', kind: 'serial' },
      { header: 'ULB Name', kind: 'name' },
      ...criteria.map(criterionColumn),
      TIED_COLUMN,
      UNTIED_COLUMN,
    ];
    const toRow = (slNo: number, ulbId: string, name: string): ClaimLetterAnnexureRow => {
      const allocation = allocations.get(ulbId)?.allocatedAmount;
      const half = allocation === undefined ? '-' : formatHalfRupeesInLakh(allocation);
      const unspent = unspentByUlbId.get(ulbId) ?? 0;
      return {
        ulbId,
        cells: [String(slNo), name, ...criteria.map((c) => buildAnnexureCell(c, ulbId, unspent)), half, half],
      };
    };

    const ineligible = expected
      .filter((u) => eligibility.perUlbEligible.get(u.ulbId) === false)
      .sort((x, y) => x.name.localeCompare(y.name));
    const rowsByList: Record<ClaimLetterListKey, ClaimLetterAnnexureRow[]> = {
      ELIGIBLE: proposal.map((p, i) => toRow(i + 1, p.ulbId, p.name)),
      INELIGIBLE: ineligible.map((u, i) => toRow(i + 1, u.ulbId, u.name)),
    };

    // Counts over this proposal; the State total (expected set) is every row's denominator.
    const total = expected.length;
    const proposalIds = proposal.map((p) => p.ulbId);
    const countWhere = (pred: (ulbId: string) => boolean) => proposalIds.reduce((n, id) => n + (pred(id) ? 1 : 0), 0);
    const ebCriterion = byType.get(CLAIM_LETTER_ROW_CRITERIA.C);
    const counts: ClaimLetterDocumentCounts = {
      stateUlbTotal: total,
      proposalUlbs: proposalIds.length,
      eligibleInProposal: countWhere((id) => eligibility.perUlbEligible.get(id) !== false),
      ineligibleStateWide: ineligible.length,
      withUnspentInProposal: countWhere((id) => (unspentByUlbId.get(id) ?? 0) > 0),
      sixthScheduleInProposal: countWhere(
        (id) => ebCriterion?.rowEvidence.get(id)?.rowValue === CLAIM_LETTER_SIXTH_SCHEDULE_VALUE,
      ),
      criteria: criteria.map((c) => ({
        type: c.type,
        label: c.label,
        met: countWhere((id) => c.buckets.get(id) === 'ELIGIBLE' || c.buckets.get(id) === 'EXEMPTED'),
        exempted: countWhere((id) => c.buckets.get(id) === 'EXEMPTED'),
      })),
    };

    return {
      stateName: stateDoc.name,
      designYearLabel: yearDoc.year,
      refNo: buildClaimLetterRefNo({
        stateCode: stateDoc.code,
        designYearLabel: yearDoc.year,
        installment: parent.installment,
        batchNumber: parent.batchNumber,
      }),
      asOn: formatIstDateTime(evaluatedAt),
      totalClaim: sumAmountsExactly(proposal.map((p) => p.claimedAmount)),
      columns,
      lists: (['ELIGIBLE', 'INELIGIBLE'] as const).map((key) => ({
        key,
        ...LIST_TEXT[key],
        total: rowsByList[key].length,
      })),
      rowsByList,
      counts,
      rowsCToK: this.buildRowsCToK(counts, yearDoc.year, new Set(criteria.map((c) => c.type))),
    };
  }

  private buildRowsCToK(
    counts: ClaimLetterDocumentCounts,
    fyLabel: string,
    enabledTypes: Set<string>,
  ): ClaimLetterComplianceRow[] {
    const total = counts.stateUlbTotal;
    const metByType = new Map(counts.criteria.map((c) => [c.type, c.met]));
    const status = (type: string, value: () => string) => [
      para([t(enabledTypes.has(type) ? value() : 'Not applicable')]),
    ];
    const metRow = (key: keyof typeof CLAIM_LETTER_ROW_CRITERIA, condition: string): ClaimLetterComplianceRow => ({
      key: `${key}.`,
      condition: [para([t(condition)])],
      status: status(CLAIM_LETTER_ROW_CRITERIA[key], () =>
        formatFraction(metByType.get(CLAIM_LETTER_ROW_CRITERIA[key]) ?? 0, total),
      ),
    });

    const rowC = metRow('C', 'Number of duly constituted ULBs/Total number of ULBs in the State');
    const n = counts.proposalUlbs;
    const sixth = counts.sixthScheduleInProposal;
    if (sixth > 0 && enabledTypes.has(CLAIM_LETTER_ROW_CRITERIA.C)) {
      rowC.status.push(
        para([]),
        para([
          t(
            `Out of the total ${n} ${plural(n, 'ULB', 'ULBs')} in this proposal, ${sixth} ` +
              `${plural(sixth, 'ULB falls', 'ULBs fall')} within areas covered under the Sixth Schedule of the ` +
              `Constitution and ${plural(sixth, 'is', 'are')} exempt from this condition.`,
          ),
        ]),
      );
    }

    const j = counts.ineligibleStateWide;
    return [
      rowC,
      metRow(
        'D',
        `Number of ULBs which have published the audited accounts of T-2, i.e., FY ${shiftFinancialYear(fyLabel, -2)}`,
      ),
      metRow(
        'E',
        `Number of ULBs which have published the provisional accounts of T-1, i.e., FY ${shiftFinancialYear(fyLabel, -1)}`,
      ),
      metRow('F', 'Number of ULBs which have linked their 16th FC accounts with PFMS'),
      {
        key: 'G.',
        condition: [para([t('Number of ULBs which have unspent balance of 14th or previous FC')])],
        status: status(FC_UNSPENT_CRITERION_TYPE, () => formatFractionOrNil(counts.withUnspentInProposal, total)),
      },
      metRow('H', 'Number of ULBs which have published their 28 Service level benchmarks'),
      metRow('I', 'Number of ULBs which have submitted detailed Utilisation report'),
      {
        key: 'J.',
        condition: [para([b('Total number of ineligible ULBs')])],
        status: j
          ? [
              para([b(String(j)), t(`/${total} (${formatPercent(j, total)}%)`)]),
              para([b('(list of ineligible ULBs has been attached for record)')]),
            ]
          : [para([t('Nil')])],
      },
      {
        key: 'K.',
        condition: [para([b('Resultantly, total number of eligible ULBs in this proposal')])],
        status: [
          para([t(formatFraction(counts.eligibleInProposal, total))]),
          para([b('(list of eligible ULBs may be perused)')]),
        ],
      },
    ];
  }

  /** Whole unspent rupees per ULB from the State's FC Unspent declaration; no form = empty map. */
  private async resolveUnspentAmounts(state: Types.ObjectId, year: Types.ObjectId): Promise<Map<string, number>> {
    const form = await this.unspentFormModel
      .findOne({ state, year, formType: FC_UNSPENT_STATE_FORM_TYPE, isDeleted: false })
      .select('_id')
      .lean<{ _id: Types.ObjectId } | null>()
      .exec();
    if (!form) return new Map();

    const rows = await this.unspentRowModel
      .find({ form: form._id, isActive: true, ulbId: { $ne: null } })
      .select('ulbId unspentAmount')
      .lean<{ ulbId: Types.ObjectId; unspentAmount: number | null }[]>()
      .exec();
    // `null` only exists on a draft row that was never finalised (final submit requires the figure).
    return new Map(rows.map((r) => [String(r.ulbId), r.unspentAmount ?? 0]));
  }

  // ─── Light part: letter details, SFC, fixed text ──────────────────────────

  private async loadLightInputs(parent: ClaimLetterDocumentParent) {
    const [sfc, formConfig, sfcExemptionStatus] = await Promise.all([
      this.sfcModel
        .findOne({ state: parent.state, year: parent.year, formType: SFC_STATUS_FORM_TYPE, isDeleted: { $ne: true } })
        .select('data.whichAwardPeriod data.awardPeriod')
        .lean<{ data?: { whichAwardPeriod?: unknown; awardPeriod?: unknown } } | null>()
        .exec(),
      this.formJsonConfigService.loadFormConfig(String(parent.year)),
      resolveSfcExemptionStatus(this.exemptionResolver, parent.state, parent.year),
    ]);
    const text = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);
    return {
      sfc: {
        whichAwardPeriod: text(sfc?.data?.whichAwardPeriod),
        awardPeriod: text(sfc?.data?.awardPeriod),
        exemptionStatus: sfcExemptionStatus,
      },
      questions: new Map(formConfig.letterQuestions.map((q) => [q.key, q])),
    };
  }

  private assemble(
    parent: ClaimLetterDocumentParent,
    annexure: ClaimLetterAnnexureMeta,
    sfc: SfcLetterValues,
    questions: Map<string, FieldConfig>,
  ): ClaimLetterDocument {
    const details = parent.letterDetails ?? {};
    const value = (key: ClaimLetterDetailKey) => formatDetailValue(details[key], questions.get(key));
    const slot = (key: ClaimLetterDetailKey, opts?: { bold?: boolean; lead?: string }) =>
      slotRun(key, value(key), CLAIM_LETTER_DETAIL_PLACEHOLDERS[key], opts);

    const annexureMeta: ClaimLetterAnnexure = { title: 'Annexure', columns: annexure.columns, lists: annexure.lists };
    return {
      refNo: annexure.refNo,
      stateName: annexure.stateName,
      designYearLabel: annexure.designYearLabel,
      installment: parent.installment,
      batchNumber: parent.batchNumber,
      asOn: annexure.asOn,
      letter: this.buildCoveringLetter(parent, annexure, sfc, slot),
      annexure: annexureMeta,
      counts: annexure.counts,
    };
  }

  private buildCoveringLetter(
    parent: ClaimLetterDocumentParent,
    annexure: ClaimLetterAnnexureMeta,
    sfc: SfcLetterValues,
    slot: (key: ClaimLetterDetailKey, opts?: { bold?: boolean; lead?: string }) => ClaimLetterRun,
  ): ClaimLetterCoveringLetter {
    const state = annexure.stateName;
    const fy = annexure.designYearLabel;
    const instalment = ordinal(parent.installment);
    const instalmentWord = parent.installment === 1 ? 'first' : 'second';
    const amountLakh = formatRupeesInLakh(annexure.totalClaim);

    const rowA: ClaimLetterComplianceRow = {
      key: 'A.',
      condition: [
        para([t('Grant transfer certificate for the previous installment along with the claims for grants')]),
        para([]),
        para([t('a) Whether Submitted')]),
        para([t('b) Amount transferred within stipulated time')]),
        para([t('c) If no, penal interest transferred')]),
      ],
      status: [
        para([t(`a) GTC of the ${previousInstallmentLabel(parent.installment, fy)} submitted by the State.`)]),
        para([t('b) '), slot('gtcTransferredInTime')]),
        para([t('c) '), slot('gtcPenalInterestDetails')]),
      ],
    };
    const rowB: ClaimLetterComplianceRow = {
      key: 'B.',
      condition: [
        para([
          t(
            'State has constituted State Finance Commission (SFC) and submitted the Action Taken Report (ATR) on its recommendation',
          ),
        ]),
      ],
      status: [
        sfc.exemptionStatus === null
          ? para([
              t('State has constituted its '),
              sfc.whichAwardPeriod ? t(sfc.whichAwardPeriod) : { ...ph('<nth SFC>'), hint: SFC_HINT },
              t(' and submitted the ATR on its recommendations vide dt. '),
              slot('sfcAtrDate'),
              t('. The recommendations of SFC are applicable till FY '),
              sfc.awardPeriod ? t(sfc.awardPeriod) : { ...ph('<award period>'), hint: SFC_HINT },
              t('.'),
            ])
          : para([
              t(
                sfc.exemptionStatus === FORM_STATUS.UNDER_REVIEW_BY_MOHUA
                  ? 'State has requested exemption from this condition; the request is under MoHUA review.'
                  : 'State has been exempted from this condition by MoHUA.',
              ),
            ]),
      ],
    };

    return {
      letterhead: para([
        b(`GOVERNMENT OF ${state.toUpperCase()}`),
        t('\n'),
        slot('departmentName', { bold: true }),
        t('\n'),
        slot('departmentAddress'),
        t('\nEmail - '),
        slot('departmentEmail'),
      ]),
      letterNo: para([b('Letter No.: '), slot('letterNo')]),
      refAndDate: para([t(`CF Ref No.- ${annexure.refNo}\n`), b('Date: '), slot('letterDate')]),
      addressee: para([
        t(
          'To,\nEconomic Advisor/ Deputy Secretary (Finance Commission Cell)\nMinistry of Housing and Urban Affairs,\n' +
            'Sankalp Bhawan, GPOA-2, Pt. Ravi Shankar Shukla Lane,\nKasturba Gandhi Marg, New Delhi-110001',
        ),
      ]),
      subject: para([
        b(
          `Subject: Claim for release of the ${instalment} instalment of basic grant (both tied and untied) to Urban ` +
            `Local Bodies in the State of ${state} for FY ${fy}, under the recommendations of the Sixteenth Finance ` +
            'Commission - reg.',
        ),
      ]),
      referencesTitle: 'Reference:',
      references: [
        para(
          [
            t(
              'Operational Guidelines for release and utilisation of grants to Urban Local Bodies under the Sixteenth ' +
                'Finance Commission for the award period 2026-27 to 2030-31.',
            ),
          ],
          '1.',
        ),
        para(
          [
            t('Ministry of Housing and Urban Affairs letter/guidelines'),
            slot('mohuaReferenceDate', { lead: ' dated ' }),
            t(', if applicable.'),
          ],
          '2.',
        ),
      ],
      salutation: para([t('Sir/Madam,')]),
      body: [
        para([
          t(
            `The undersigned is directed to submit herewith the claim of the Government of ${state} for the release of ` +
              `${instalment} installment grants to Urban Local Bodies (ULBs) under the recommendations of the Sixteenth ` +
              `Finance Commission for FY ${fy}, in accordance with the applicable Operational Guidelines issued by the ` +
              'Department of Expenditure, Ministry of Finance.',
          ),
        ]),
        para(
          [
            t('The State Government hereby claims the release of '),
            b(`₹${amountLakh} lakh (Rupees ${rupeesToIndianWords(annexure.totalClaim)} only)`),
            t(
              ` towards basic grant (tied and untied) for the ${instalmentWord} instalment of FY ${fy}. The details of ` +
                'the claim, including the amount claimed and the relevant compliance particulars, are furnished in the ' +
                'enclosed statement.',
            ),
          ],
          '2.',
        ),
        para(
          [
            t(
              'It is certified that the State Government has reviewed the relevant eligibility conditions and complied ' +
                'with the applicable requirements prescribed under the Sixteenth Finance Commission recommendations and ' +
                'the Operational Guidelines as below-',
            ),
          ],
          '3.',
        ),
      ],
      complianceHeaders: [
        'S. No.',
        'Type of condition for basic grant as per Operational Guidelines',
        'Status of Compliance',
      ],
      compliance: [rowA, rowB, ...annexure.rowsCToK],
      note: para([b('Note: '), t(`Row J and the List of Ineligible ULBs are as on ${annexure.asOn}.`)]),
      closing: [
        para(
          [
            t(
              'The State Government further certifies that the particulars furnished in the claim and the accompanying ' +
                'documents are true and correct to the best of its knowledge and that the grants, upon release, shall be ' +
                'transferred to the eligible ULBs and utilised strictly in accordance with the prescribed guidelines and ' +
                'conditions.',
            ),
          ],
          '4.',
        ),
        para(
          [
            t(
              'It is, therefore, requested that the Ministry may kindly examine the claim and recommend for the release ' +
                'of the admissible grant amount of ',
            ),
            b(`₹${amountLakh} lakh`),
            t(
              ` for FY ${fy}, in accordance with the applicable provisions of the Sixteenth Finance Commission grant ` +
                'framework.',
            ),
          ],
          '5.',
        ),
      ],
      signOff: para([t('Yours faithfully,')]),
      signature: para([
        ph('<Signature>'),
        t('\n'),
        slot('officerName', { bold: true }),
        t('\n'),
        slot('officerDesignation'),
        t(`\nGovernment of ${state}`),
      ]),
    };
  }
}
