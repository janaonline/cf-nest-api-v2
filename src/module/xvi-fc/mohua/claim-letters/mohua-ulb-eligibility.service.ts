import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { FORM_STATUS, getFormStatusLabel } from 'src/common/constants/form-status.constants';
import { escapeRegex } from 'src/common/utils/regex.util';
import { RedisService } from 'src/core/services/redis/redis.service';
import { ExpectedUlbSetService } from 'src/module/xvi-fc/common/services/expected-ulb-set.service';
import { criterionColumn } from 'src/module/xvi-fc/state/claim-letter/helpers/claim-letter-letter.helpers';
import { ClaimLetterDocumentService } from 'src/module/xvi-fc/state/claim-letter/services/document/claim-letter-document.service';
import { ClaimLetterEligibilityService } from 'src/module/xvi-fc/state/claim-letter/services/eligibility/claim-letter-eligibility.service';
import { State } from 'src/schemas/state.schema';
import { Year } from 'src/schemas/year.schema';
import { ClaimLetterBatch } from 'src/schemas/xvi-fc/state/claim-letter-batch.schema';
import { ClaimLetterUlbLock } from 'src/schemas/xvi-fc/state/claim-letter-ulb-lock.schema';
import {
  MOHUA_CLAIM_LETTERS_INSTALLMENT,
  MOHUA_CLAIM_LETTERS_LISTED_STATUSES,
  MOHUA_ULB_ELIGIBILITY_CACHE_TTL_SECONDS,
  MOHUA_ULB_ELIGIBILITY_REFRESH_FLOOR_SECONDS,
  MOHUA_ULB_ELIGIBILITY_DEFAULT_LIMIT,
  MOHUA_ULB_ELIGIBILITY_DRAFT_LABEL,
  MOHUA_ULB_ELIGIBILITY_NO_ALLOCATION,
  MOHUA_ULB_ELIGIBILITY_NO_ALLOCATION_LABEL,
} from './mohua-claim-letters.constants';
import type { GetMohuaUlbEligibilityQueryDto } from './mohua-claim-letters-query.dto';
import type {
  MohuaUlbEligibility,
  MohuaUlbEligibilityBatch,
  MohuaUlbEligibilityBuild,
  MohuaUlbEligibilityBuildRow,
} from './mohua-claim-letters.types';
import {
  buildLiveConditionCell,
  countBy,
  matchesUlbEligibilityQuery,
  noUlbHasStarted,
  type MohuaUlbEligibilityJoinedRow,
} from './mohua-ulb-eligibility.helpers';

/**
 * MoHUA's live view of every ULB in a State: eligible or not, why, and which letter holds it. The condition check runs
 * over the whole State and is cached 15 minutes (filters, counts and totals need every row). The letter holding each
 * ULB is read live on every request.
 */
@Injectable()
export class MohuaUlbEligibilityService {
  private readonly logger = new Logger(MohuaUlbEligibilityService.name);
  private readonly env: string;
  /** One build per State at a time in this process; requests made together share it. */
  private readonly builds = new Map<string, Promise<MohuaUlbEligibilityBuild>>();

  constructor(
    @InjectModel(State.name) private readonly stateModel: Model<State>,
    @InjectModel(Year.name) private readonly yearModel: Model<Year>,
    @InjectModel(ClaimLetterBatch.name) private readonly batchModel: Model<ClaimLetterBatch>,
    @InjectModel(ClaimLetterUlbLock.name) private readonly lockModel: Model<ClaimLetterUlbLock>,
    private readonly eligibilityService: ClaimLetterEligibilityService,
    private readonly expectedUlbSetService: ExpectedUlbSetService,
    private readonly documentService: ClaimLetterDocumentService,
    private readonly redis: RedisService,
    config: ConfigService,
  ) {
    this.env = config.get<string>('NODE_ENV') ?? 'production';
  }

  async getUlbEligibility(
    stateId: string,
    yearId: string,
    installment: number,
    query: GetMohuaUlbEligibilityQueryDto,
  ): Promise<MohuaUlbEligibility> {
    if (installment !== MOHUA_CLAIM_LETTERS_INSTALLMENT) {
      throw new NotFoundException(`Installment ${installment} is not supported yet`);
    }
    const [build, batchByUlbId] = await Promise.all([
      this.getBuild(stateId, yearId, query.refresh === true),
      this.resolveHoldingLetters(stateId, yearId),
    ]);

    const joined: MohuaUlbEligibilityJoinedRow[] = build.rows.map((row) => ({
      row,
      batch: batchByUlbId.get(row.ulbId) ?? null,
    }));
    const term = query.search?.trim();
    const pattern = term ? new RegExp(escapeRegex(term), 'i') : null;
    const filtered = joined.filter((r) => matchesUlbEligibilityQuery(r, query, pattern));

    const limit = query.limit ?? MOHUA_ULB_ELIGIBILITY_DEFAULT_LIMIT;
    const totalPages = Math.max(1, Math.ceil(filtered.length / limit));
    const page = Math.min(query.page ?? 1, totalPages);
    const offset = (page - 1) * limit;
    const allocationTotal = filtered.reduce((sum, { row }) => sum + (row.allocation ?? 0), 0);
    const held = joined.flatMap(({ batch }) => (batch ? [batch] : []));
    const eligible = build.rows.filter((r) => r.eligible).length;

    return {
      asOn: build.asOn,
      stateName: build.stateName,
      designYearLabel: build.designYearLabel,
      installment,
      stateGate: build.stateGate,
      noneStarted: build.noneStarted,
      columns: build.columns,
      conditions: [
        ...build.columns.map((c) => ({ key: c.key, label: c.label })),
        { key: MOHUA_ULB_ELIGIBILITY_NO_ALLOCATION, label: MOHUA_ULB_ELIGIBILITY_NO_ALLOCATION_LABEL },
      ],
      counts: {
        total: build.rows.length,
        eligible,
        ineligible: build.rows.length - eligible,
        inLetter: held.length,
        notInLetter: build.rows.length - held.length,
        eligibleNotInLetter: joined.filter(({ row, batch }) => row.eligible && !batch).length,
        batches: countBy(held.map((b) => b.batchNumber)).map(({ key, count }) => ({ batchNumber: key, count })),
        letterStatuses: countBy(held.map((b) => b.status)).map(({ key, count }) => ({ status: key, count })),
      },
      totals: { tied: allocationTotal / 2, untied: allocationTotal / 2 },
      items: filtered.slice(offset, offset + limit).map(({ row, batch }, i) => {
        const half = row.allocation === null ? null : row.allocation / 2;
        return {
          slNo: offset + i + 1,
          ulbId: row.ulbId,
          name: row.name,
          censusCode: row.censusCode,
          sbCode: row.sbCode,
          tied: half,
          untied: half,
          cells: row.cells,
          amounts: row.amounts,
          eligible: row.eligible,
          failedConditions: row.failedConditions,
          batch,
        };
      }),
      pagination: { page, limit, total: filtered.length, totalPages },
    };
  }

  private cacheKey(stateId: string, yearId: string): string {
    return `mohuaUlbEligibility:${this.env}:${stateId}:${yearId}:${MOHUA_CLAIM_LETTERS_INSTALLMENT}`;
  }

  private async getBuild(stateId: string, yearId: string, refresh: boolean): Promise<MohuaUlbEligibilityBuild> {
    const key = this.cacheKey(stateId, yearId);
    const cached = await this.readCache(key);
    const ageSeconds = cached ? (Date.now() - Date.parse(cached.asOn)) / 1000 : Infinity;
    if (cached && (!refresh || ageSeconds < MOHUA_ULB_ELIGIBILITY_REFRESH_FLOOR_SECONDS)) return cached;

    let pending = this.builds.get(key);
    if (!pending) {
      pending = this.build(stateId, yearId)
        .then(async (built) => {
          await this.writeCache(key, built);
          return built;
        })
        .finally(() => this.builds.delete(key));
      this.builds.set(key, pending);
    }
    return pending;
  }

  /** Redis is only a cache here: if it fails, the page is built without it rather than failing. */
  private async readCache(key: string): Promise<MohuaUlbEligibilityBuild | null> {
    try {
      const cached = await this.redis.get(key);
      return cached === null ? null : (JSON.parse(cached) as MohuaUlbEligibilityBuild);
    } catch (error) {
      this.logger.warn(`ULB eligibility cache read failed for ${key}: ${(error as Error).message}`);
      return null;
    }
  }

  private async writeCache(key: string, built: MohuaUlbEligibilityBuild): Promise<void> {
    try {
      await this.redis.set(key, JSON.stringify(built), MOHUA_ULB_ELIGIBILITY_CACHE_TTL_SECONDS);
    } catch (error) {
      this.logger.warn(`ULB eligibility cache write failed for ${key}: ${(error as Error).message}`);
    }
  }

  /** Fixed queries, run together: the State's expected ULBs, the State gate, allocations, unspent amounts, and every
   *  ULB-level condition (the fresh check the letter's annexure runs, since the cell text needs each criterion). */
  private async build(stateId: string, yearId: string): Promise<MohuaUlbEligibilityBuild> {
    const installment = MOHUA_CLAIM_LETTERS_INSTALLMENT;
    const expectedPromise = this.expectedUlbSetService.resolve(stateId, yearId);
    const [stateDoc, yearDoc, expected, gate, allocations, unspent, eligibility] = await Promise.all([
      this.stateModel.findById(stateId).select('name').lean<{ name: string } | null>().exec(),
      this.yearModel.findById(yearId).select('year').lean<{ year: string } | null>().exec(),
      expectedPromise,
      this.eligibilityService.evaluateStateLevelGate(stateId, yearId, installment),
      this.eligibilityService.resolveDevolutionAllocations(stateId, yearId, installment),
      this.documentService.resolveUnspentAmounts(new Types.ObjectId(stateId), new Types.ObjectId(yearId)),
      expectedPromise.then((ulbs) =>
        this.eligibilityService.resolveUlbLevelEligibility(
          stateId,
          yearId,
          installment,
          ulbs.map((u) => u.ulbId),
        ),
      ),
    ]);
    if (!stateDoc) throw new NotFoundException(`State ${stateId} not found`);
    if (!yearDoc) throw new NotFoundException(`Year ${yearId} not found`);

    const criteria = eligibility.perCriterion;
    const rows: MohuaUlbEligibilityBuildRow[] = expected.map((ulb) => {
      const conditionCells = criteria.map((c) => buildLiveConditionCell(c, ulb.ulbId, unspent.get(ulb.ulbId) ?? 0));
      const allocation = allocations.get(ulb.ulbId)?.allocatedAmount ?? null;
      const failedConditions = criteria.filter((c) => c.buckets.get(ulb.ulbId) === 'INELIGIBLE').map((c) => c.type);
      if (allocation === null) failedConditions.push(MOHUA_ULB_ELIGIBILITY_NO_ALLOCATION);
      return {
        ulbId: ulb.ulbId,
        name: ulb.name,
        censusCode: ulb.censusCode,
        sbCode: ulb.sbCode,
        allocation,
        cells: conditionCells.map((c) => c.text),
        amounts: conditionCells.map((c) => c.amount),
        eligible: failedConditions.length === 0,
        failedConditions,
      };
    });
    // Eligible first, then ineligible, each A to Z. Sorted once per build, so requests reuse the order.
    rows.sort((a, b) => Number(b.eligible) - Number(a.eligible) || a.name.localeCompare(b.name));

    return {
      asOn: new Date().toISOString(),
      stateName: stateDoc.name,
      designYearLabel: yearDoc.year,
      stateGate: {
        passed: gate.passed,
        failedConditions: gate.sources
          .filter((s) => s.result === 'FAILED')
          .map((s) => ({
            label: s.displayLabel ?? s.formType,
            statusLabel: getFormStatusLabel(s.statusAtEvaluation ?? FORM_STATUS.NOT_STARTED),
          })),
      },
      noneStarted: noUlbHasStarted(
        criteria,
        expected.map((u) => u.ulbId),
      ),
      // The letter's header without its unit: the portal page has its own amount units.
      columns: criteria.map((c) => ({
        key: c.type,
        label: c.label,
        header: c.letterColumnLabel,
        kind: criterionColumn(c).kind,
      })),
      rows,
    };
  }

  /** The letter holding each ULB: its lock, then the letter. Two queries; returned letters hold no locks. */
  private async resolveHoldingLetters(stateId: string, yearId: string): Promise<Map<string, MohuaUlbEligibilityBatch>> {
    const locks = await this.lockModel
      .find({
        state: new Types.ObjectId(stateId),
        year: new Types.ObjectId(yearId),
        installment: MOHUA_CLAIM_LETTERS_INSTALLMENT,
        lockState: { $in: ['ACTIVE', 'ACKNOWLEDGED'] },
      })
      .select('ulbId claimLetter')
      .lean<{ ulbId: Types.ObjectId; claimLetter: Types.ObjectId }[]>()
      .exec();
    if (!locks.length) return new Map();

    const letterIds = [...new Set(locks.map((l) => String(l.claimLetter)))];
    const letters = await this.batchModel
      .find({ _id: { $in: letterIds.map((id) => new Types.ObjectId(id)) } })
      .select('batchNumber currentFormStatus')
      .lean<{ _id: Types.ObjectId; batchNumber: number; currentFormStatus: number }[]>()
      .exec();
    const letterById = new Map(letters.map((l) => [String(l._id), l]));

    const result = new Map<string, MohuaUlbEligibilityBatch>();
    for (const lock of locks) {
      const letter = letterById.get(String(lock.claimLetter));
      if (!letter) continue;
      const status = letter.currentFormStatus;
      result.set(String(lock.ulbId), {
        claimLetterId: String(letter._id),
        batchNumber: letter.batchNumber,
        status,
        statusLabel:
          status === FORM_STATUS.IN_PROGRESS ? MOHUA_ULB_ELIGIBILITY_DRAFT_LABEL : getFormStatusLabel(status),
        linkable: MOHUA_CLAIM_LETTERS_LISTED_STATUSES.includes(status),
      });
    }
    return result;
  }
}
