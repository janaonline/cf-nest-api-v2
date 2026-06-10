import {
  BadRequestException,
  ConflictException,
  HttpException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import type { ApiClientContext } from 'src/module/auth/types/api-client-context.type';
import type { User } from 'src/module/auth/enum/role.enum';
import type { FinancialDataTemplateQueryDto } from 'src/module/line-items-legends/dto/financial-data-template-query.dto';
import { LineItemsLegendService } from 'src/module/line-items-legends/line-items-legend.service';
import {
  DEFAULT_TEMPLATE_VERSION,
  type LineItemLegendForValidation,
  type Rule,
} from 'src/module/line-items-legends/types';
import { Ulb, UlbDocument } from 'src/schemas/ulb.schema';
import { Year, YearDocument } from 'src/schemas/year.schema';
import { DATA_COLLECTION_COMPUTED_CONFIG, DATA_COLLECTION_FAILURE_REASON } from '../constant';
import { DataCollectionDto } from '../dto/data-collection.dto';
import { GetDataCollectionDto } from '../dto/get-data-collection.dto';
import { ReverseDataCollectionDto } from '../dto/reverse-data-collection.dto';
import { DataCollection, DataCollectionDocument } from '../entities/data-collection.schema';
import type {
  ActiveDataCollectionFilter,
  ComputedValues,
  DataCollectionRequestMeta,
  DataCollectionResponseSource,
  DataCollectionValidationIssue,
  ExternalDataCollectionResponse,
  SubmittedLineItems,
  ValidationContext,
  ValidationOutcome,
} from '../types/data-collection.types';
import { DataCollectionAuditLogService } from './data-collection-audit-log.service';
import { DataCollectionAuthorizationService } from './data-collection-authorization.service';
import { DataCollectionReferenceResolverService } from './data-collection-reference-resolver.service';

@Injectable()
export class DataCollectionService {
  private readonly logger = new Logger(DataCollectionService.name);

  constructor(
    @InjectModel(DataCollection.name)
    private readonly dataCollectionModel: Model<DataCollectionDocument>,

    @InjectModel(Ulb.name)
    private readonly ulbModel: Model<UlbDocument>,

    @InjectModel(Year.name)
    private readonly yearModel: Model<YearDocument>,

    private readonly authorizationService: DataCollectionAuthorizationService,
    private readonly lineItemsLegendService: LineItemsLegendService,
    private readonly referenceResolverService: DataCollectionReferenceResolverService,
    private readonly auditLogService: DataCollectionAuditLogService,
  ) {}

  /** Returns the current financial data template from DB. */
  getFinancialDataTemplate(query: FinancialDataTemplateQueryDto = {}) {
    return this.lineItemsLegendService.getFinancialDataTemplate(query);
  }

  /**
   * Returns ULBs accessible by the API client as { code, name, state } objects.
   * code is censusCode when set, sbCode otherwise; ULBs with no public code are skipped.
   * STATE clients see all active ULBs in their state.
   * ULB clients see only their own ULB.
   */
  async getUlbsList(client: ApiClientContext) {
    try {
      type UlbWithState = Pick<Ulb, 'name' | 'censusCode' | 'sbCode'> & {
        state: { name: string; code: string } | null;
      };
      const filter = this.authorizationService.getAllowedUlbFilter(client);
      const ulbs = await this.ulbModel
        .find(filter)
        .select({ _id: 0, name: 1, censusCode: 1, sbCode: 1, state: 1 })
        .populate<{ state: { name: string; code: string } | null }>({
          path: 'state',
          select: { _id: 0, name: 1, code: 1 },
        })
        .lean<UlbWithState[]>();
      return ulbs
        .filter((u) => u.censusCode ?? u.sbCode)
        .map((u) => ({
          code: u.censusCode ?? u.sbCode,
          name: u.name,
          state: u.state ?? undefined,
        }));
    } catch (error: unknown) {
      this.createErrorResponse(error, 'getUlbsList');
    }
  }

  /** Returns active financial years as { yearCode, displayName } pairs, latest year first. */
  async getYearsList() {
    try {
      const years = await this.yearModel.find({ isActive: true }, { _id: 0, year: 1 }).lean<Pick<Year, 'year'>[]>();
      return years
        .map((y) => ({ yearCode: y.year, displayName: y.year }))
        .sort((a, b) => this.getYearStart(b.yearCode) - this.getYearStart(a.yearCode));
    } catch (error: unknown) {
      this.createErrorResponse(error, 'getYearsList');
    }
  }

  /** Extracts the 4-digit start year from a year code like '2024-25'. */
  private getYearStart(yearCode: string): number {
    const start = Number(yearCode.split('-')[0]);
    return Number.isFinite(start) ? start : 0;
  }

  /**
   * Finds the active financial data submission for a ULB and financial year.
   * Uses public identifiers and enforces integration client access.
   */
  async findOneByUlbAndYear(
    query: GetDataCollectionDto,
    client: ApiClientContext,
  ): Promise<ExternalDataCollectionResponse> {
    const { ulbCode, yearCode, templateVersion } = query;
    const { ulbId } = await this.referenceResolverService.resolveUlbByCode(ulbCode);
    const { yearId, yearCode: resolvedYearCode } = await this.referenceResolverService.resolveYearByCode(yearCode);

    await this.authorizationService.validateCanAccessUlb(client, ulbId.toString());

    const filter: ActiveDataCollectionFilter = {
      ulbId,
      yearId,
      isActive: true,
      status: 'ACTIVE',
      ...(templateVersion ? { templateVersion } : {}),
    };

    const data = await this.dataCollectionModel
      .findOne(filter, {
        _id: 0,
        templateVersion: 1,
        validationStatus: 1,
        status: 1,
        lineItems: 1,
        createdAt: 1,
        updatedAt: 1,
      })
      .lean<DataCollectionResponseSource | null>();

    if (!data) {
      const message = templateVersion
        ? `Financial data for ulbCode: ${ulbCode}, yearCode: ${yearCode} and templateVersion: ${templateVersion} does not exist.`
        : `Financial data for ulbCode: ${ulbCode} and yearCode: ${yearCode} does not exist.`;
      throw new NotFoundException({
        message,
        code: DATA_COLLECTION_FAILURE_REASON.DATA_COLLECTION_NOT_FOUND,
      });
    }

    return this.mapToExternalDataCollectionResponse(data, ulbCode, resolvedYearCode);
  }

  /**
   * Submits new financial data for a ULB and year.
   * Resolves ulbCode/yearCode to internal ObjectIds before storing.
   * Sparse lineItems are allowed — only submitted keys are stored.
   * All submitted keys must be valid nmamCodes and must not be computed.* prefixed.
   * Computes and stores the four financial totals in the top-level `computed` field.
   */
  async create(payload: DataCollectionDto, client: ApiClientContext, meta: DataCollectionRequestMeta = {}) {
    const { ulbCode, yearCode, lineItems: payloadLineItems } = payload;
    const templateVersion = payload.templateVersion ?? DEFAULT_TEMPLATE_VERSION;

    const { ulbId, stateId } = await this.referenceResolverService.resolveUlbByCode(ulbCode);
    const { yearId, yearCode: resolvedYearCode } = await this.referenceResolverService.resolveYearByCode(yearCode);

    await this.authorizationService.validateCanSubmitForUlb(client, ulbId.toString());

    const lineItemCount = this.getLineItemCount(payloadLineItems);

    const existing = await this.dataCollectionModel
      .findOne({ ulbId, yearId, isActive: true, status: 'ACTIVE' })
      .lean<DataCollectionDocument>();

    const apiClientId = this.getApiClientObjectId(client);

    if (existing) {
      await this.auditLogService.logDuplicateSubmit({
        apiClientId,
        dataCollectionId: existing._id,
        stateId,
        ulbId,
        yearId,
        templateVersion,
        lineItemCount,
        ip: meta.ip,
        userAgent: meta.userAgent,
      });
      throw new ConflictException(
        `Data for ulbCode: ${ulbCode} and yearCode: ${yearCode} already exists. Try using PATCH method.`,
      );
    }

    const legends = await this.lineItemsLegendService.getActiveLegendsForValidation(templateVersion);
    const result = this.validateLineItemsAgainstTemplate(payloadLineItems, legends, templateVersion);

    if (result.hasErrors) {
      await this.auditLogService.logValidationFailed({
        apiClientId,
        stateId,
        ulbId,
        yearId,
        templateVersion,
        lineItemCount,
        ip: meta.ip,
        userAgent: meta.userAgent,
        errorCount: result.errors.length,
        validationSummary: {
          errors: result.errors.map((e) => ({
            lineItemCode: e.lineItemCode,
            message: e.message,
            severity: e.severity,
            expected: e.expected,
            received: e.received,
          })),
        },
      });
      throw new BadRequestException({
        ulbCode,
        yearCode,
        templateVersion,
        success: false,
        errors: result.errors,
        lineItems: payloadLineItems,
      });
    }

    try {
      const created = new this.dataCollectionModel({
        apiClientId,
        ulbId,
        stateId,
        yearId,
        yearCode: resolvedYearCode,
        templateVersion,
        lineItems: result.submittedLineItems,
        computed: result.computed,
        validationStatus: 'VALID',
        isActive: true,
        status: 'ACTIVE',
      });
      const data = await created.save();
      await this.auditLogService.logSubmitted({
        apiClientId,
        stateId,
        ulbId,
        yearId,
        templateVersion,
        lineItemCount,
        ip: meta.ip,
        userAgent: meta.userAgent,
        dataCollectionId: data._id,
        validationStatus: data.validationStatus,
      });
      return {
        message: 'Financial data submitted successfully.',
        data: this.mapToExternalDataCollectionResponse(data, ulbCode, yearCode),
      };
    } catch (error: unknown) {
      this.createErrorResponse(error, 'create');
    }
  }

  /**
   * Updates existing financial data for a ULB and year.
   * Merges existing lineItems with incoming, then validates the merged set.
   * Recomputes all four financial totals from the final merged lineItems.
   * Backfills stateId/yearCode on older records that pre-date those fields.
   */
  async update(payload: DataCollectionDto, client: ApiClientContext, meta: DataCollectionRequestMeta = {}) {
    const { ulbCode, yearCode, lineItems: payloadLineItems } = payload;

    const { ulbId, stateId } = await this.referenceResolverService.resolveUlbByCode(ulbCode);
    const { yearId, yearCode: resolvedYearCode } = await this.referenceResolverService.resolveYearByCode(yearCode);

    await this.authorizationService.validateCanModifyForUlb(client, ulbId.toString());

    const existing = await this.dataCollectionModel.findOne({ ulbId, yearId, isActive: true, status: 'ACTIVE' });

    const lineItemCount = this.getLineItemCount(payloadLineItems);

    const apiClientId = this.getApiClientObjectId(client);

    if (!existing) {
      await this.auditLogService.logModifyNotFound({
        apiClientId,
        stateId,
        ulbId,
        yearId,
        templateVersion: payload.templateVersion ?? DEFAULT_TEMPLATE_VERSION,
        lineItemCount,
        ip: meta.ip,
        userAgent: meta.userAgent,
      });
      throw new NotFoundException(
        `Data for ulbCode: ${ulbCode} and yearCode: ${yearCode} does not exist. Try using POST method.`,
      );
    }

    const existingTemplateVersion = existing.templateVersion ?? DEFAULT_TEMPLATE_VERSION;
    if (payload.templateVersion && payload.templateVersion !== existingTemplateVersion) {
      throw new BadRequestException('templateVersion cannot be changed for an existing data collection record.');
    }
    const templateVersion = existingTemplateVersion;

    const changedLineItemCodes = this.getChangedLineItemCodes(existing.lineItems, payloadLineItems);

    // Unconditional merge — null from payload is intentional, validation decides validity.
    const mergedLineItems: Record<string, unknown> = Object.fromEntries(existing.lineItems) as Record<string, unknown>;
    for (const [key, value] of Object.entries(payloadLineItems)) {
      mergedLineItems[key] = value;
    }

    const legends = await this.lineItemsLegendService.getActiveLegendsForValidation(templateVersion);
    const result = this.validateLineItemsAgainstTemplate(mergedLineItems, legends, templateVersion);

    if (result.hasErrors) {
      await this.auditLogService.logValidationFailed({
        apiClientId,
        stateId,
        ulbId,
        yearId,
        templateVersion,
        lineItemCount,
        ip: meta.ip,
        userAgent: meta.userAgent,
        errorCount: result.errors.length,
        validationSummary: {
          errors: result.errors.map((e) => ({
            lineItemCode: e.lineItemCode,
            message: e.message,
            severity: e.severity,
            expected: e.expected,
            received: e.received,
          })),
        },
      });
      throw new BadRequestException({
        ulbCode,
        yearCode,
        templateVersion,
        success: false,
        errors: result.errors,
        lineItems: mergedLineItems,
      });
    }

    existing.templateVersion = templateVersion;
    existing.lineItems = new Map(Object.entries(result.submittedLineItems));
    existing.computed = result.computed;
    existing.validationStatus = 'VALID';
    // Backfill denormalized fields if missing from records created before these fields were added.
    if (!existing.stateId) existing.stateId = stateId;
    if (!existing.yearCode) existing.yearCode = resolvedYearCode;

    try {
      const data = await existing.save();
      await this.auditLogService.logModified({
        apiClientId,
        stateId,
        ulbId,
        yearId,
        templateVersion,
        changedLineItemCodes,
        lineItemCount,
        ip: meta.ip,
        userAgent: meta.userAgent,
        dataCollectionId: data._id,
        validationStatus: data.validationStatus,
      });
      return {
        message: 'Financial data updated successfully.',
        data: this.mapToExternalDataCollectionResponse(data, ulbCode, yearCode),
      };
    } catch (error: unknown) {
      this.createErrorResponse(error, 'update');
    }
  }

  /**
   * Reverses an active data collection submission.
   * Marks the record as inactive/reversed without deleting it.
   * Only ACTIVE records can be reversed. Reversed records no longer block corrected resubmission.
   */
  async reverseSubmission(dto: ReverseDataCollectionDto, admin: User, meta: DataCollectionRequestMeta = {}) {
    const { ulbCode, yearCode, reason } = dto;
    const templateVersion = dto.templateVersion ?? DEFAULT_TEMPLATE_VERSION;

    const { ulbId, stateId } = await this.referenceResolverService.resolveUlbByCode(ulbCode);
    const { yearId } = await this.referenceResolverService.resolveYearByCode(yearCode);

    const adminId = this.getAdminObjectId(admin);

    const existing = await this.dataCollectionModel.findOne({ ulbId, yearId, isActive: true, status: 'ACTIVE' });

    if (!existing) {
      throw new NotFoundException(
        `No active data collection record found for ulbCode: ${ulbCode} and yearCode: ${yearCode}.`,
      );
    }

    existing.isActive = false;
    existing.status = 'REVERSED';
    existing.reversedAt = new Date();
    existing.reversedBy = adminId;
    existing.reversalReason = reason;

    try {
      const data = await existing.save();
      await this.auditLogService.logReversed({
        adminUserId: adminId,
        dataCollectionId: data._id,
        stateId,
        ulbId,
        yearId,
        templateVersion: data.templateVersion ?? templateVersion,
        reason,
        ip: meta.ip,
        userAgent: meta.userAgent,
      });
      return {
        message: 'Financial data submission reversed successfully.',
        data: {
          ulbCode,
          yearCode,
          templateVersion: data.templateVersion,
          status: data.status,
          reversedAt: data.reversedAt,
          reversalReason: data.reversalReason,
        },
      };
    } catch (error: unknown) {
      this.createErrorResponse(error, 'reverseSubmission');
    }
  }

  // ─── Validation pipeline ──────────────────────────────────────────────────

  /**
   * Orchestrates the full validation pipeline:
   *   Step 1 — buildValidationContext: one pass over lineItems (key/value checks,
   *             legendByCode map, submittedLegendItems collection).
   *   Step 2 — computeDataCollectionTotals: compute all four totals in one pass
   *             over DATA_COLLECTION_COMPUTED_CONFIG.
   *   Step 3 — validateSubmittedLineItemRules: formula + comparison rules for
   *             submitted legend items only (no full legendMap scan).
   *   Step 4 — validateMandatoryComparisonRules: one legendMap pass for codes
   *             with comparison rules that were NOT submitted.
   *   Step 5 — validateComputedTotals: comparison checks against DATA_COLLECTION_COMPUTED_CONFIG
   *             (no DB legend records needed).
   */
  private validateLineItemsAgainstTemplate(
    lineItems: Record<string, unknown>,
    legendItems: LineItemLegendForValidation[],
    templateVersion: string,
  ): ValidationOutcome {
    const errors: DataCollectionValidationIssue[] = [];

    const { context, errors: contextErrors } = this.buildValidationContext(lineItems, legendItems, templateVersion);
    errors.push(...contextErrors);

    errors.push(...this.validateSubmittedLineItemRules(context));
    errors.push(...this.validateMandatoryComparisonRules(context));
    errors.push(...this.validateComputedTotals(context.computed, context.legendByCode));

    return {
      errors,
      hasErrors: errors.length > 0,
      computed: context.computed,
      submittedLineItems: context.submittedLineItems,
    };
  }

  /**
   * Step 1: Builds the validation context in one focused pass over lineItems.
   * Rejects computed.* keys, unknown codes, and non-finite values.
   * Collects submittedLegendItems directly — avoids a later legendMap scan.
   * Computes all four financial totals (Step 2) and attaches them to the context.
   */
  private buildValidationContext(
    lineItems: Record<string, unknown>,
    legendItems: LineItemLegendForValidation[],
    templateVersion: string,
  ): { context: ValidationContext; errors: DataCollectionValidationIssue[] } {
    const errors: DataCollectionValidationIssue[] = [];

    const legendByCode = new Map(legendItems.map((l) => [l.nmamCode, l]));
    const submittedLineItems: Record<string, number> = {};
    const invalidSubmittedCodes = new Set<string>();
    const submittedLegendItems: LineItemLegendForValidation[] = [];

    for (const [code, value] of Object.entries(lineItems)) {
      if (this.isComputedCode(code)) {
        errors.push({
          lineItemCode: code,
          value,
          severity: 'ERROR',
          message: `${code} is a computed validation key and cannot be submitted in lineItems.`,
        });
        continue;
      }
      if (!legendByCode.has(code)) {
        errors.push({
          lineItemCode: code,
          value,
          severity: 'ERROR',
          message: `Line item code does not exist in template version ${templateVersion}.`,
        });
        continue;
      }
      const issue = this.validateLineItemValue(code, value);
      if (issue) {
        errors.push(issue);
        invalidSubmittedCodes.add(code);
        continue;
      }
      submittedLineItems[code] = value as number;
      submittedLegendItems.push(legendByCode.get(code)!);
    }

    const computed = this.computeDataCollectionTotals(submittedLineItems, legendByCode);

    return {
      context: { submittedLineItems, invalidSubmittedCodes, legendByCode, submittedLegendItems, computed },
      errors,
    };
  }

  /**
   * Step 2: Computes all four financial totals from submitted line items.
   * Source codes absent from the payload contribute 0 (sparse behaviour).
   * Source codes absent from legendByCode also contribute 0 — the template is
   * authoritative and missing codes are treated as not applicable for this version.
   */
  private computeDataCollectionTotals(
    lineItems: Readonly<Record<string, number>>,
    legendByCode: ReadonlyMap<string, LineItemLegendForValidation>,
  ): ComputedValues {
    const computed: ComputedValues = { totIncome: 0, totExpenditure: 0, totRevenue: 0, totOwnRevenue: 0 };

    for (const key of Object.keys(DATA_COLLECTION_COMPUTED_CONFIG) as Array<
      keyof typeof DATA_COLLECTION_COMPUTED_CONFIG
    >) {
      const { sourceCodes } = DATA_COLLECTION_COMPUTED_CONFIG[key];
      let total = 0;
      for (const code of sourceCodes) {
        if (!legendByCode.has(code)) continue; // code not in this template version — treat as 0
        const v = lineItems[code];
        if (typeof v === 'number') total += v;
      }
      computed[key] = total;
    }

    return computed;
  }

  /**
   * Step 3: Validates formula and comparison rules for submitted legend items only.
   * Uses submittedLegendItems collected in buildValidationContext — no full legendMap scan.
   */
  private validateSubmittedLineItemRules(ctx: ValidationContext): DataCollectionValidationIssue[] {
    const { submittedLineItems, legendByCode, submittedLegendItems } = ctx;
    const errors: DataCollectionValidationIssue[] = [];

    for (const legend of submittedLegendItems) {
      if (!legend.rules.length || this.isComputedLegend(legend)) continue;
      const { nmamCode: code } = legend;
      const value = submittedLineItems[code];

      for (const rule of legend.rules) {
        if (rule.type === 'comparison') {
          errors.push(...this.validateComparisonRule(code, value, rule));
        } else {
          errors.push(
            ...this.validateRuleForLineItem(
              code,
              value,
              rule,
              submittedLineItems as Record<string, unknown>,
              legendByCode,
            ),
          );
        }
      }
    }

    return errors;
  }

  /**
   * Step 4: Validates mandatory comparison rules for codes that were NOT submitted.
   * Codes that were submitted (valid or invalid) are skipped — already handled above.
   * One pass over legendByCode; skips computed legends and skips submitted codes.
   */
  private validateMandatoryComparisonRules(ctx: ValidationContext): DataCollectionValidationIssue[] {
    const { submittedLineItems, invalidSubmittedCodes, legendByCode } = ctx;
    const errors: DataCollectionValidationIssue[] = [];

    for (const [code, legend] of legendByCode.entries()) {
      if (this.isComputedLegend(legend)) continue;
      if (code in submittedLineItems) continue; // handled in validateSubmittedLineItemRules
      if (invalidSubmittedCodes.has(code)) continue; // invalid value already reported — no duplicate

      for (const rule of legend.rules) {
        if (rule.type !== 'comparison') continue;
        errors.push({
          lineItemCode: code,
          value: undefined,
          severity: 'ERROR',
          message: `Business validation for lineItemCode ${code} cannot be validated because the line item was not submitted.`,
          validationRule: rule,
        });
      }
    }

    return errors;
  }

  /**
   * Step 5: Validates computed financial totals against DATA_COLLECTION_COMPUTED_CONFIG.
   * A metric is only validated when ALL of its configured source codes exist in legendByCode
   * — this ensures partial template mocks in tests do not produce spurious config errors,
   * while production templates (which contain every source code) are fully validated.
   */
  private validateComputedTotals(
    computed: ComputedValues,
    legendByCode: ReadonlyMap<string, LineItemLegendForValidation>,
  ): DataCollectionValidationIssue[] {
    const errors: DataCollectionValidationIssue[] = [];

    for (const key of Object.keys(DATA_COLLECTION_COMPUTED_CONFIG) as Array<
      keyof typeof DATA_COLLECTION_COMPUTED_CONFIG
    >) {
      const { label, comparison, sourceCodes } = DATA_COLLECTION_COMPUTED_CONFIG[key];

      // Skip if any configured source code is absent from the template — template is incomplete.
      if (!sourceCodes.every((code) => legendByCode.has(code))) continue;

      const { operator, value: threshold } = comparison;
      const actual = computed[key];
      const passes = this.applyComparisonOperator(actual, operator, threshold);
      if (!passes) {
        errors.push({
          lineItemCode: `computed.${key}`,
          value: actual,
          severity: 'ERROR',
          message: `${label} must be ${operator} ${threshold}. Received: ${actual}.`,
          validationRule: { type: 'comparison', operator, value: threshold },
          expectedCondition: `${operator} ${threshold}`,
          received: actual,
        });
      }
    }

    return errors;
  }

  // ─── Rule validators (unchanged behaviour) ────────────────────────────────

  /**
   * Validates one line item value.
   * Accepts any finite number including 0. Rejects null, NaN, Infinity, strings, and objects.
   */
  private validateLineItemValue(code: string, value: unknown): DataCollectionValidationIssue | null {
    if (typeof value === 'number' && isFinite(value)) return null;
    return {
      lineItemCode: code,
      value,
      severity: 'ERROR',
      message: `lineItemCode: ${code} must be a finite number.`,
    };
  }

  /** Returns true when value is a finite number (type guard). */
  private isFiniteNumber(value: unknown): value is number {
    return typeof value === 'number' && isFinite(value);
  }

  /** Returns true when the code represents a virtual computed validation target. */
  private isComputedCode(code: string): boolean {
    return code.startsWith('computed.');
  }

  /** Returns true when the legend is a virtual computed validation target. */
  private isComputedLegend(legend: LineItemLegendForValidation): boolean {
    return legend.isComputed === true || legend.nmamCode.startsWith('computed.');
  }

  /**
   * Applies a comparison operator and returns whether the condition passes.
   * Unknown operators fail closed (return false).
   */
  private applyComparisonOperator(value: number, operator: string, threshold: number): boolean {
    switch (operator) {
      case '<=':
        return value <= threshold;
      case '>=':
        return value >= threshold;
      case '===':
        return value === threshold;
      case '!==':
        return value !== threshold;
      case '<':
        return value < threshold;
      case '>':
        return value > threshold;
      default:
        return false;
    }
  }

  /**
   * Dispatches a single rule to the formula or comparison validator.
   * Unknown rule types fail closed — they return an error, not silent skip.
   */
  private validateRuleForLineItem(
    code: string,
    value: unknown,
    rule: Rule,
    lineItems: Record<string, unknown>,
    legendMap: Map<string, LineItemLegendForValidation>,
  ): DataCollectionValidationIssue[] {
    switch (rule.type) {
      case 'formula':
        return this.validateFormulaRule(code, value, rule, lineItems, legendMap);
      case 'comparison':
        return this.validateComparisonRule(code, value, rule);
      default:
        return [
          {
            lineItemCode: code,
            value,
            severity: 'ERROR',
            message: `lineItemCode: ${code} has an unsupported rule type.`,
            validationRule: rule,
          },
        ];
    }
  }

  /**
   * Dispatches to the correct formula validator by operation.
   * Unknown operations fail closed.
   */
  private validateFormulaRule(
    code: string,
    value: unknown,
    rule: Extract<Rule, { type: 'formula' }>,
    lineItems: Record<string, unknown>,
    legendMap: Map<string, LineItemLegendForValidation>,
  ): DataCollectionValidationIssue[] {
    switch (rule.operation) {
      case 'sum':
        return this.validateFormulaSumRule(code, value, rule, lineItems, legendMap);
      case 'diff':
        return this.validateFormulaDiffRule(code, value, rule, lineItems, legendMap);
      case 'linear':
        return this.validateFormulaLinearRule(code, value, rule, lineItems, legendMap);
      default:
        return [
          {
            lineItemCode: code,
            value,
            severity: 'ERROR',
            message: `lineItemCode: ${code} has an unsupported formula operation.`,
            validationRule: rule,
          },
        ];
    }
  }

  /**
   * Resolves string operand codes for sum/diff rules.
   * Separates unknown codes from submitted operands; sparse (not submitted) are silently skipped.
   */
  private resolveStringOperands(
    operandCodes: string[],
    lineItems: Record<string, unknown>,
    legendMap: Map<string, LineItemLegendForValidation>,
  ): { submittedOperands: { code: string; value: number }[]; unknownOperandCodes: string[] } {
    const submittedOperands: { code: string; value: number }[] = [];
    const unknownOperandCodes: string[] = [];

    for (const c of operandCodes) {
      if (!legendMap.has(c)) {
        unknownOperandCodes.push(c);
        continue;
      }
      if (!(c in lineItems)) continue;
      const v = lineItems[c];
      if (this.isFiniteNumber(v)) submittedOperands.push({ code: c, value: v });
    }

    return { submittedOperands, unknownOperandCodes };
  }

  /**
   * Validates formula sum: parent must equal sum of submitted operands.
   * Sparse — missing operands are skipped. Fails if none submitted or unknown operand found.
   */
  private validateFormulaSumRule(
    code: string,
    value: unknown,
    rule: Extract<Rule, { type: 'formula'; operation: 'sum' }>,
    lineItems: Record<string, unknown>,
    legendMap: Map<string, LineItemLegendForValidation>,
  ): DataCollectionValidationIssue[] {
    const numericParent = this.isFiniteNumber(value) ? value : null;
    const { submittedOperands, unknownOperandCodes } = this.resolveStringOperands(rule.operands, lineItems, legendMap);
    const submittedCodes = submittedOperands.map((o) => o.code);

    if (unknownOperandCodes.length > 0) {
      return unknownOperandCodes.map((oc) => ({
        lineItemCode: code,
        value,
        severity: 'ERROR' as const,
        message: `Formula rule for lineItemCode: ${code} refers to unknown operand ${oc}.`,
        validationRule: rule,
        submittedOperands: submittedCodes,
        expected: null,
        received: numericParent,
      }));
    }

    if (submittedOperands.length === 0) {
      return [
        {
          lineItemCode: code,
          value,
          severity: 'ERROR',
          message: `lineItemCode: ${code} cannot be validated because none of its operands were submitted.`,
          validationRule: rule,
          submittedOperands: [],
          expected: null,
          received: numericParent,
        },
      ];
    }

    const expected = submittedOperands.reduce((acc, o) => acc + o.value, 0);
    if (this.isFiniteNumber(value) && value !== expected) {
      return [
        {
          lineItemCode: code,
          value,
          severity: 'ERROR',
          message: `lineItemCode: ${code} must equal sum of submitted operands ${submittedCodes.join(', ')}. Expected: ${expected}, Received: ${value}.`,
          validationRule: rule,
          submittedOperands: submittedCodes,
          expected,
          received: value,
        },
      ];
    }

    return [];
  }

  /**
   * Validates formula diff: parent = first_operand - remaining_operands (in submitted order).
   * Requires at least 2 submitted operands. Sparse — missing operands are skipped.
   */
  private validateFormulaDiffRule(
    code: string,
    value: unknown,
    rule: Extract<Rule, { type: 'formula'; operation: 'diff' }>,
    lineItems: Record<string, unknown>,
    legendMap: Map<string, LineItemLegendForValidation>,
  ): DataCollectionValidationIssue[] {
    const numericParent = this.isFiniteNumber(value) ? value : null;
    const { submittedOperands, unknownOperandCodes } = this.resolveStringOperands(rule.operands, lineItems, legendMap);
    const submittedCodes = submittedOperands.map((o) => o.code);

    if (unknownOperandCodes.length > 0) {
      return unknownOperandCodes.map((oc) => ({
        lineItemCode: code,
        value,
        severity: 'ERROR' as const,
        message: `Formula rule for lineItemCode: ${code} refers to unknown operand ${oc}.`,
        validationRule: rule,
        submittedOperands: submittedCodes,
        expected: null,
        received: numericParent,
      }));
    }

    if (submittedOperands.length === 0) {
      return [
        {
          lineItemCode: code,
          value,
          severity: 'ERROR',
          message: `lineItemCode: ${code} cannot be validated because none of its operands were submitted.`,
          validationRule: rule,
          submittedOperands: [],
          expected: null,
          received: numericParent,
        },
      ];
    }

    if (submittedOperands.length === 1) {
      return [
        {
          lineItemCode: code,
          value,
          severity: 'ERROR',
          message: `lineItemCode: ${code} diff rule requires at least 2 submitted operands. Only ${submittedCodes[0]} was submitted.`,
          validationRule: rule,
          submittedOperands: submittedCodes,
          expected: null,
          received: numericParent,
        },
      ];
    }

    const expected = submittedOperands[0].value - submittedOperands.slice(1).reduce((acc, o) => acc + o.value, 0);
    if (this.isFiniteNumber(value) && value !== expected) {
      return [
        {
          lineItemCode: code,
          value,
          severity: 'ERROR',
          message: `lineItemCode: ${code} must equal diff of submitted operands ${submittedCodes.join(', ')}. Expected: ${expected}, Received: ${value}.`,
          validationRule: rule,
          submittedOperands: submittedCodes,
          expected,
          received: value,
        },
      ];
    }

    return [];
  }

  /**
   * Validates formula linear: parent = sum of (operand.value * operand.sign) for submitted operands.
   * Operand shapes are validated at runtime; invalid sign or code fails closed.
   */
  private validateFormulaLinearRule(
    code: string,
    value: unknown,
    rule: Extract<Rule, { type: 'formula'; operation: 'linear' }>,
    lineItems: Record<string, unknown>,
    legendMap: Map<string, LineItemLegendForValidation>,
  ): DataCollectionValidationIssue[] {
    const numericParent = this.isFiniteNumber(value) ? value : null;

    for (const operand of rule.operands) {
      const sign = operand.sign as number;
      if (typeof operand.code !== 'string' || (sign !== 1 && sign !== -1)) {
        return [
          {
            lineItemCode: code,
            value,
            severity: 'ERROR',
            message: `lineItemCode: ${code} has a linear rule with an invalid operand shape.`,
            validationRule: rule,
          },
        ];
      }
    }

    const submittedOperands: { code: string; value: number; sign: 1 | -1 }[] = [];
    const unknownOperandCodes: string[] = [];

    for (const operand of rule.operands) {
      if (!legendMap.has(operand.code)) {
        unknownOperandCodes.push(operand.code);
        continue;
      }
      if (!(operand.code in lineItems)) continue;
      const v = lineItems[operand.code];
      if (this.isFiniteNumber(v)) submittedOperands.push({ code: operand.code, value: v, sign: operand.sign });
    }

    const submittedCodes = submittedOperands.map((o) => o.code);

    if (unknownOperandCodes.length > 0) {
      return unknownOperandCodes.map((oc) => ({
        lineItemCode: code,
        value,
        severity: 'ERROR' as const,
        message: `Formula rule for lineItemCode: ${code} refers to unknown operand ${oc}.`,
        validationRule: rule,
        submittedOperands: submittedCodes,
        expected: null,
        received: numericParent,
      }));
    }

    if (submittedOperands.length === 0) {
      return [
        {
          lineItemCode: code,
          value,
          severity: 'ERROR',
          message: `lineItemCode: ${code} cannot be validated because none of its operands were submitted.`,
          validationRule: rule,
          submittedOperands: [],
          expected: null,
          received: numericParent,
        },
      ];
    }

    const expected = submittedOperands.reduce((acc, o) => acc + o.value * o.sign, 0);
    if (this.isFiniteNumber(value) && value !== expected) {
      const display = submittedOperands
        .map((o) => `${o.sign === 1 ? '+' : '-'}${o.code}`)
        .join(' ')
        .replace(/^\+/, '');
      return [
        {
          lineItemCode: code,
          value,
          severity: 'ERROR',
          message: `lineItemCode: ${code} must equal linear combination (${display}). Expected: ${expected}, Received: ${value}.`,
          validationRule: rule,
          submittedOperands: submittedCodes,
          expected,
          received: value,
        },
      ];
    }

    return [];
  }

  /**
   * Validates a comparison rule against a finite numeric value.
   * Skipped when value is not finite (pass 1 already reported invalid value — no duplicate error).
   * Unknown operators fail closed.
   */
  private validateComparisonRule(
    code: string,
    value: unknown,
    rule: Extract<Rule, { type: 'comparison' }>,
  ): DataCollectionValidationIssue[] {
    if (!this.isFiniteNumber(value)) return [];

    const { operator, value: threshold } = rule;
    const knownOperators = new Set(['<=', '>=', '===', '!==', '<', '>']);

    if (!knownOperators.has(operator)) {
      return [
        {
          lineItemCode: code,
          value,
          severity: 'ERROR',
          message: `lineItemCode: ${code} has an unsupported comparison operator.`,
          validationRule: rule,
        },
      ];
    }

    const passes = this.applyComparisonOperator(value, operator, threshold);
    if (!passes) {
      return [
        {
          lineItemCode: code,
          value,
          severity: 'ERROR',
          message: `lineItemCode: ${code} must be ${operator} ${threshold}. Received: ${value}.`,
          validationRule: rule,
          expectedCondition: `${operator} ${threshold}`,
          received: value,
        },
      ];
    }

    return [];
  }

  // ─── Utility helpers ──────────────────────────────────────────────────────

  /**
   * Maps a saved data collection document to an external API response.
   * Excludes Mongo identifiers (_id, ulbId, stateId, yearId, __v) and returns public codes.
   */
  private mapToExternalDataCollectionResponse(
    data: DataCollectionResponseSource,
    ulbCode: string,
    yearCode: string,
  ): ExternalDataCollectionResponse {
    if (data.status !== 'ACTIVE') {
      throw new InternalServerErrorException('Unexpected data collection status.');
    }

    return {
      ulbCode,
      yearCode,
      templateVersion: data.templateVersion,
      validationStatus: data.validationStatus,
      status: data.status,
      lineItems: this.toPlainLineItems(data.lineItems),
      createdAt: data.createdAt,
      updatedAt: data.updatedAt,
    };
  }

  /** Converts Mongoose Map or lean object lineItems into a plain sparse object. */
  private toPlainLineItems(lineItems: Map<string, number> | Record<string, number>): Record<string, number> {
    if (lineItems instanceof Map) return Object.fromEntries(lineItems);
    return { ...lineItems };
  }

  private getAdminObjectId(admin: User): Types.ObjectId {
    if (!Types.ObjectId.isValid(admin._id)) {
      throw new InternalServerErrorException('Invalid admin user context.');
    }
    return new Types.ObjectId(admin._id);
  }

  private getApiClientObjectId(client: ApiClientContext): Types.ObjectId {
    if (!Types.ObjectId.isValid(client.apiClientId)) {
      throw new InternalServerErrorException('Invalid API client context.');
    }
    return new Types.ObjectId(client.apiClientId);
  }

  private getLineItemCount(lineItems: SubmittedLineItems): number {
    return Object.keys(lineItems).length;
  }

  private getChangedLineItemCodes(existing: Map<string, number>, incoming: SubmittedLineItems): string[] {
    return Object.keys(incoming).filter((key) => existing.get(key) !== incoming[key]);
  }

  /** Transforms any error into an appropriate HTTP exception and re-throws. */
  private createErrorResponse(error: unknown, functionName: string): never {
    this.logger.error(`${functionName}() Failed to perform operation`, error);
    if (error instanceof HttpException) throw error;
    if (error instanceof Error && error.name === 'ValidationError') throw new BadRequestException(error.message);
    throw new InternalServerErrorException('Something went wrong while processing DataCollection');
  }
}
