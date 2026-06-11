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
import { DATA_COLLECTION_FAILURE_REASON } from '../constant';
import { DataCollectionDto } from '../dto/data-collection.dto';
import { GetDataCollectionDto } from '../dto/get-data-collection.dto';
import { ReverseDataCollectionDto } from '../dto/reverse-data-collection.dto';
import { DataCollection, DataCollectionDocument } from '../entities/data-collection.schema';
import {
  extractComputedKey,
  type ActiveDataCollectionFilter,
  type ComputedValues,
  type ComputedValuesKey,
  type DataCollectionRequestMeta,
  type DataCollectionResponseSource,
  type DataCollectionValidationIssue,
  type DataCollectionValidationResult,
  type ExternalDataCollectionResponse,
  type SubmittedLineItems,
} from '../types/data-collection.types';
import { DataCollectionAuditLogService } from './data-collection-audit-log.service';
import { DataCollectionAuthorizationService } from './data-collection-authorization.service';
import { DataCollectionReferenceResolverService } from './data-collection-reference-resolver.service';

// ─── Private module-level types ──────────────────────────────────────────────

type LegendIndex = {
  legendByCode: Map<string, LineItemLegendForValidation>;
  regularLegends: LineItemLegendForValidation[];
  computedLegends: LineItemLegendForValidation[];
};

type ValidationContext = LegendIndex & {
  /** Validated finite-number values keyed by nmamCode. Sparse — only submitted. */
  submittedLineItems: Record<string, number>;
  /** Codes submitted with non-finite values; already reported — skip duplicate errors. */
  invalidSubmittedCodes: Set<string>;
};

type ValidationOutcome = DataCollectionValidationResult & {
  computed: ComputedValues;
  submittedLineItems: Record<string, number>;
};

// ─────────────────────────────────────────────────────────────────────────────

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

  private getYearStart(yearCode: string): number {
    const start = Number(yearCode.split('-')[0]);
    return Number.isFinite(start) ? start : 0;
  }

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
   * Computed totals are derived from DB computed legends and stored in DataCollection.computed.
   */
  async create(payload: DataCollectionDto, client: ApiClientContext, meta: DataCollectionRequestMeta = {}) {
    const { ulbCode, yearCode, lineItems: payloadLineItems } = payload;
    const templateVersion = payload.templateVersion ?? DEFAULT_TEMPLATE_VERSION;

    const [resolvedUlb, resolvedYear] = await Promise.all([
      this.referenceResolverService.resolveUlbByCode(ulbCode),
      this.referenceResolverService.resolveYearByCode(yearCode),
    ]);
    const { ulbId, stateId } = resolvedUlb;
    const { yearId, yearCode: resolvedYearCode } = resolvedYear;

    await this.authorizationService.validateCanSubmitForUlb(client, ulbId.toString());

    const lineItemCount = this.getLineItemCount(payloadLineItems);
    const apiClientId = this.getApiClientObjectId(client);

    const [existing, legends] = await Promise.all([
      this.dataCollectionModel
        .findOne({ ulbId, yearId, isActive: true, status: 'ACTIVE' })
        .lean<DataCollectionDocument | null>(),
      this.lineItemsLegendService.getActiveLegendsForValidation(templateVersion),
    ]);

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
   * Recomputes all computed totals from final merged lineItems using DB computed legends.
   */
  async update(payload: DataCollectionDto, client: ApiClientContext, meta: DataCollectionRequestMeta = {}) {
    const { ulbCode, yearCode, lineItems: payloadLineItems } = payload;

    const [resolvedUlb, resolvedYear] = await Promise.all([
      this.referenceResolverService.resolveUlbByCode(ulbCode),
      this.referenceResolverService.resolveYearByCode(yearCode),
    ]);
    const { ulbId, stateId } = resolvedUlb;
    const { yearId, yearCode: resolvedYearCode } = resolvedYear;

    await this.authorizationService.validateCanModifyForUlb(client, ulbId.toString());

    const lineItemCount = this.getLineItemCount(payloadLineItems);
    const apiClientId = this.getApiClientObjectId(client);

    const legendsTemplateVersion = payload.templateVersion ?? DEFAULT_TEMPLATE_VERSION;
    const [existing, legends] = await Promise.all([
      this.dataCollectionModel.findOne({ ulbId, yearId, isActive: true, status: 'ACTIVE' }),
      this.lineItemsLegendService.getActiveLegendsForValidation(legendsTemplateVersion),
    ]);

    if (!existing) {
      await this.auditLogService.logModifyNotFound({
        apiClientId,
        stateId,
        ulbId,
        yearId,
        templateVersion: legendsTemplateVersion,
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

    const mergedLineItems: Record<string, unknown> = Object.fromEntries(existing.lineItems) as Record<string, unknown>;
    for (const [key, value] of Object.entries(payloadLineItems)) {
      mergedLineItems[key] = value;
    }

    // Step 07: synchronous validation against the loaded legends.
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
   * Orchestrates the DB-driven 3-pass validation pipeline:
   *
   *   Pass 1 (over legendItems): categorise → legendByCode, regularLegends, computedLegends
   *   Pass 2 (over submitted lineItems): validate keys/values → submittedLineItems
   *   Pass 3a (over regularLegends): comparison rules always; formula rules only for submitted parents
   *   Pass 3b (over computedLegends): evaluate formula from DB rules; validate comparison; store computed
   *
   * Computed legends drive what is calculated — no hardcoded source codes or operators in this service.
   */
  private validateLineItemsAgainstTemplate(
    lineItems: Record<string, unknown>,
    legendItems: LineItemLegendForValidation[],
    templateVersion: string,
  ): ValidationOutcome {
    const { context, errors: contextErrors } = this.buildValidationContext(lineItems, legendItems, templateVersion);
    const regularErrors = this.validateRegularLegendRules(context);
    const { errors: computedErrors, computed } = this.evaluateComputedLegends(context);

    const errors = [...contextErrors, ...regularErrors, ...computedErrors];
    return {
      errors,
      hasErrors: errors.length > 0,
      computed,
      submittedLineItems: context.submittedLineItems,
    };
  }

  /**
   * Pass 1: Categorises legends → legendByCode, regularLegends, computedLegends.
   * Pass 2: Validates submitted lineItems → submittedLineItems, invalidSubmittedCodes.
   */
  private buildValidationContext(
    lineItems: Record<string, unknown>,
    legendItems: LineItemLegendForValidation[],
    templateVersion: string,
  ): { context: ValidationContext; errors: DataCollectionValidationIssue[] } {
    const legendByCode = new Map<string, LineItemLegendForValidation>();
    const regularLegends: LineItemLegendForValidation[] = [];
    const computedLegends: LineItemLegendForValidation[] = [];

    for (const legend of legendItems) {
      legendByCode.set(legend.nmamCode, legend);
      if (legend.isComputed === true) {
        computedLegends.push(legend);
      } else {
        regularLegends.push(legend);
      }
    }

    const errors: DataCollectionValidationIssue[] = [];
    const submittedLineItems: Record<string, number> = {};
    const invalidSubmittedCodes = new Set<string>();

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
    }

    return {
      context: { legendByCode, regularLegends, computedLegends, submittedLineItems, invalidSubmittedCodes },
      errors,
    };
  }

  /**
   * Pass 3a: One pass over regular legends.
   * Comparison rules are mandatory — validated for submitted and non-submitted codes alike.
   * Formula rules are sparse — validated only when the parent code was submitted.
   */
  private validateRegularLegendRules(ctx: ValidationContext): DataCollectionValidationIssue[] {
    const { submittedLineItems, invalidSubmittedCodes, legendByCode } = ctx;
    const errors: DataCollectionValidationIssue[] = [];

    for (const legend of ctx.regularLegends) {
      if (!legend.rules.length) continue;
      const { nmamCode: code } = legend;
      const isSubmitted = code in submittedLineItems;
      const isInvalidSubmitted = invalidSubmittedCodes.has(code);

      for (const rule of legend.rules) {
        if (rule.type === 'comparison') {
          if (isSubmitted) {
            errors.push(...this.validateComparisonRule(code, submittedLineItems[code], rule));
          } else if (!isInvalidSubmitted) {
            // Mandatory: not submitted and not already flagged as invalid value
            errors.push({
              lineItemCode: code,
              value: undefined,
              severity: 'ERROR',
              message: `Business validation for lineItemCode ${code} cannot be validated because the line item was not submitted.`,
              validationRule: rule,
            });
          }
        } else if (isSubmitted) {
          // Formula rules: sparse — only when parent is submitted
          errors.push(
            ...this.validateRuleForLineItem(
              code,
              submittedLineItems[code],
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
   * Pass 3b: One pass over computed legends.
   * For each computed legend:
   *   1. Evaluate its formula rule using submitted lineItems (absent-but-configured codes = 0)
   *   2. Validate comparison rules against the computed value
   *   3. Store in ComputedValues under the key derived from nmamCode (e.g. 'totIncome')
   *
   * If a formula operand is not in legendByCode (DB corruption), a configuration error is emitted.
   */
  private evaluateComputedLegends(ctx: ValidationContext): {
    errors: DataCollectionValidationIssue[];
    computed: ComputedValues;
  } {
    const errors: DataCollectionValidationIssue[] = [];
    const computed: ComputedValues = { totIncome: 0, totExpenditure: 0, totRevenue: 0, totOwnRevenue: 0 };

    for (const legend of ctx.computedLegends) {
      const key = extractComputedKey(legend.nmamCode);
      if (!key) {
        this.logger.warn(`Computed legend '${legend.nmamCode}' has unrecognized ComputedValues key — skipping`);
        continue;
      }

      let computedValue = 0;
      let formulaFailed = false;

      for (const rule of legend.rules) {
        if (rule.type !== 'formula') continue;
        const result = this.evaluateFormulaForComputed(
          legend.nmamCode,
          key,
          rule,
          ctx.submittedLineItems,
          ctx.legendByCode,
        );
        if (result.configError) {
          errors.push(result.configError);
          formulaFailed = true;
          break;
        }
        computedValue = result.value;
        break; // Use the first formula rule
      }

      if (formulaFailed) continue;
      computed[key] = computedValue;

      for (const rule of legend.rules) {
        if (rule.type !== 'comparison') continue;
        if (!this.applyComparisonOperator(computedValue, rule.operator, rule.value)) {
          errors.push({
            lineItemCode: `computed.${key}`,
            value: computedValue,
            severity: 'ERROR',
            message: `${legend.name} must be ${rule.operator} ${rule.value}. Received: ${computedValue}.`,
            validationRule: rule,
            expectedCondition: `${rule.operator} ${rule.value}`,
            received: computedValue,
          });
        }
      }
    }

    return { errors, computed };
  }

  /**
   * Evaluates a single formula rule for a computed legend.
   * Source codes in legendByCode but not submitted → contribute 0 (sparse behaviour).
   * Source codes NOT in legendByCode → configuration error (should have been caught at import).
   */
  private evaluateFormulaForComputed(
    legendNmamCode: string,
    key: ComputedValuesKey,
    rule: Extract<Rule, { type: 'formula' }>,
    lineItems: Readonly<Record<string, number>>,
    legendByCode: ReadonlyMap<string, LineItemLegendForValidation>,
  ): { value: number; configError?: undefined } | { value: 0; configError: DataCollectionValidationIssue } {
    const makeConfigError = (missingCode: string): { value: 0; configError: DataCollectionValidationIssue } => {
      this.logger.error(
        `Computed legend '${legendNmamCode}' references '${missingCode}' which is absent from the active template`,
      );
      return {
        value: 0,
        configError: {
          lineItemCode: `computed.${key}`,
          value: null,
          severity: 'ERROR',
          message: `Configuration error: computed formula for ${legendNmamCode} references unknown legend '${missingCode}'.`,
        },
      };
    };

    if (rule.operation === 'sum') {
      let total = 0;
      for (const code of rule.operands) {
        if (!legendByCode.has(code)) return makeConfigError(code);
        total += lineItems[code] ?? 0;
      }
      return { value: total };
    }

    if (rule.operation === 'diff') {
      const values: number[] = [];
      for (const code of rule.operands) {
        if (!legendByCode.has(code)) return makeConfigError(code);
        values.push(lineItems[code] ?? 0);
      }
      const total = values.length > 0 ? values[0] - values.slice(1).reduce((a, b) => a + b, 0) : 0;
      return { value: total };
    }

    if (rule.operation === 'linear') {
      let total = 0;
      for (const { code, sign } of rule.operands) {
        if (!legendByCode.has(code)) return makeConfigError(code);
        total += (lineItems[code] ?? 0) * sign;
      }
      return { value: total };
    }

    return { value: 0 };
  }

  // ─── Rule validators (unchanged behaviour) ────────────────────────────────

  private validateLineItemValue(code: string, value: unknown): DataCollectionValidationIssue | null {
    if (typeof value === 'number' && isFinite(value)) return null;
    return {
      lineItemCode: code,
      value,
      severity: 'ERROR',
      message: `lineItemCode: ${code} must be a finite number.`,
    };
  }

  private isFiniteNumber(value: unknown): value is number {
    return typeof value === 'number' && isFinite(value);
  }

  private isComputedCode(code: string): boolean {
    return code.startsWith('computed.');
  }

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

  private createErrorResponse(error: unknown, functionName: string): never {
    this.logger.error(`${functionName}() Failed to perform operation`, error);
    if (error instanceof HttpException) throw error;
    if (error instanceof Error && error.name === 'ValidationError') throw new BadRequestException(error.message);
    throw new InternalServerErrorException('Something went wrong while processing DataCollection');
  }
}
