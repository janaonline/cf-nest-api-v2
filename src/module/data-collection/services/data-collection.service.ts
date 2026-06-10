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
import type {
  ActiveDataCollectionFilter,
  DataCollectionRequestMeta,
  DataCollectionResponseSource,
  DataCollectionValidationIssue,
  DataCollectionValidationResult,
  ExternalDataCollectionResponse,
  FormulaComputeResult,
  SubmittedLineItems,
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
   * All submitted keys must be valid nmamCodes. Submitted parents must equal
   * the sum of their submitted operands. Throws BadRequestException on any error.
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
    const legendMap = new Map(legends.map((l) => [l.nmamCode, l]));
    const result = this.validateLineItemsAgainstTemplate(payloadLineItems, legendMap, templateVersion);

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
        lineItems: payloadLineItems,
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
   * Resolves ulbCode/yearCode to internal ObjectIds before updating.
   * Merges existing lineItems with incoming, then validates the merged set.
   * Sparse merged data is allowed; submitted parents must equal their submitted operand sums.
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
    const legendMap = new Map(legends.map((l) => [l.nmamCode, l]));
    const result = this.validateLineItemsAgainstTemplate(mergedLineItems, legendMap, templateVersion);

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
    existing.lineItems = new Map(Object.entries(mergedLineItems) as [string, number][]);
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

  /**
   * Converts admin user id from request context to ObjectId.
   * @param admin Authenticated admin user.
   * @returns Admin user ObjectId.
   */
  private getAdminObjectId(admin: User): Types.ObjectId {
    if (!Types.ObjectId.isValid(admin._id)) {
      throw new InternalServerErrorException('Invalid admin user context.');
    }

    return new Types.ObjectId(admin._id);
  }

  /**
   * Converts API client id from request context to ObjectId.
   * @param client Authenticated API client context.
   * @returns API client ObjectId.
   */
  private getApiClientObjectId(client: ApiClientContext): Types.ObjectId {
    if (!Types.ObjectId.isValid(client.apiClientId)) {
      throw new InternalServerErrorException('Invalid API client context.');
    }

    return new Types.ObjectId(client.apiClientId);
  }

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

  /**
   * Pass 1: validates submitted keys/values; rejects computed.* keys.
   * Pass 2: sparse formula rules for submitted real NMAM codes.
   * Pass 3: mandatory direct comparison rules for all non-computed NMAM codes.
   * Pass 4: computed legend values and their comparison rules.
   */
  private validateLineItemsAgainstTemplate(
    lineItems: Record<string, unknown>,
    legendMap: Map<string, LineItemLegendForValidation>,
    templateVersion: string,
  ): DataCollectionValidationResult {
    const errors: DataCollectionValidationIssue[] = [];

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
      if (!legendMap.has(code)) {
        errors.push({
          lineItemCode: code,
          value,
          severity: 'ERROR',
          message: `Line item code does not exist in template version ${templateVersion}.`,
        });
        continue;
      }
      const issue = this.validateLineItemValue(code, value);
      if (issue) errors.push(issue);
    }

    errors.push(...this.validateRulesForSubmittedLineItems(lineItems, legendMap));
    errors.push(...this.validateDirectComparisonRules(lineItems, legendMap));
    errors.push(...this.validateComputedLegends(lineItems, legendMap));

    return { errors, hasErrors: errors.length > 0 };
  }

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

  /**
   * Pass 2: applies formula and unknown-type rules for submitted real NMAM codes (sparse).
   * Comparison rules are handled by validateDirectComparisonRules.
   * Computed legends are handled by validateComputedLegends.
   */
  private validateRulesForSubmittedLineItems(
    lineItems: Record<string, unknown>,
    legendMap: Map<string, LineItemLegendForValidation>,
  ): DataCollectionValidationIssue[] {
    const errors: DataCollectionValidationIssue[] = [];

    for (const code of Object.keys(lineItems)) {
      const legend = legendMap.get(code);
      if (!legend?.rules.length || this.isComputedLegend(legend)) continue;

      for (const rule of legend.rules) {
        if (rule.type === 'comparison') continue; // handled by validateDirectComparisonRules
        errors.push(...this.validateRuleForLineItem(code, lineItems[code], rule, lineItems, legendMap));
      }
    }

    return errors;
  }

  /**
   * Pass 3: validates comparison rules for all non-computed NMAM codes.
   * Submitted codes with valid values are validated inline.
   * Non-submitted codes with comparison rules return a mandatory-field error.
   * Invalid submitted values are skipped (pass 1 already reported them).
   */
  private validateDirectComparisonRules(
    lineItems: Record<string, unknown>,
    legendMap: Map<string, LineItemLegendForValidation>,
  ): DataCollectionValidationIssue[] {
    const errors: DataCollectionValidationIssue[] = [];

    for (const [code, legend] of legendMap.entries()) {
      if (this.isComputedLegend(legend)) continue;
      const comparisonRules = legend.rules.filter(
        (r): r is Extract<Rule, { type: 'comparison' }> => r.type === 'comparison',
      );
      if (!comparisonRules.length) continue;

      if (!(code in lineItems)) {
        for (const rule of comparisonRules) {
          errors.push({
            lineItemCode: code,
            value: undefined,
            severity: 'ERROR',
            message: `Business validation for lineItemCode ${code} cannot be validated because the line item was not submitted.`,
            validationRule: rule,
          });
        }
      } else {
        const value = lineItems[code];
        if (!this.isFiniteNumber(value)) continue; // pass 1 already reported the invalid value
        for (const rule of comparisonRules) {
          errors.push(...this.validateComparisonRule(code, value, rule));
        }
      }
    }

    return errors;
  }

  /**
   * Pass 4: computes virtual computed.* values and validates their comparison rules.
   * Computed values are never stored; they exist only for this validation pass.
   */
  private validateComputedLegends(
    lineItems: Record<string, unknown>,
    legendMap: Map<string, LineItemLegendForValidation>,
  ): DataCollectionValidationIssue[] {
    const { computedValues, errors } = this.computeVirtualLineItemValues(lineItems, legendMap);
    const comparisonErrors: DataCollectionValidationIssue[] = [];

    for (const [code, value] of Object.entries(computedValues)) {
      const legend = legendMap.get(code);
      if (!legend) continue;
      for (const rule of legend.rules) {
        if (rule.type !== 'comparison') continue;
        comparisonErrors.push(...this.validateComparisonRule(code, value, rule));
      }
    }

    return [...errors, ...comparisonErrors];
  }

  /**
   * Computes virtual computed.* validation values from submitted line items.
   * Each computed legend must have one formula rule that defines its value.
   * Does not store results; returns them for validateComputedLegends.
   */
  private computeVirtualLineItemValues(
    lineItems: Record<string, unknown>,
    legendMap: Map<string, LineItemLegendForValidation>,
  ): { computedValues: Record<string, number>; errors: DataCollectionValidationIssue[] } {
    const computedValues: Record<string, number> = {};
    const errors: DataCollectionValidationIssue[] = [];

    for (const [code, legend] of legendMap.entries()) {
      if (!this.isComputedLegend(legend)) continue;

      const formulaRule = legend.rules.find((r): r is Extract<Rule, { type: 'formula' }> => r.type === 'formula');
      if (!formulaRule) {
        errors.push({
          lineItemCode: code,
          value: undefined,
          severity: 'ERROR',
          message: `Computed legend ${code} has no formula rule to calculate its value.`,
        });
        continue;
      }

      const result = this.computeFormulaValue(code, formulaRule, lineItems, legendMap);
      if ('errors' in result) {
        errors.push(...result.errors);
      } else {
        computedValues[code] = result.value;
      }
    }

    return { computedValues, errors };
  }

  /**
   * Computes the numeric value of a formula rule for a computed legend.
   * Returns { value, submittedCodes } on success or { errors } on failure.
   */
  private computeFormulaValue(
    code: string,
    rule: Extract<Rule, { type: 'formula' }>,
    lineItems: Record<string, unknown>,
    legendMap: Map<string, LineItemLegendForValidation>,
  ): FormulaComputeResult {
    switch (rule.operation) {
      case 'sum': {
        const { submittedOperands, unknownOperandCodes } = this.resolveStringOperands(
          rule.operands,
          lineItems,
          legendMap,
        );
        if (unknownOperandCodes.length > 0) {
          return {
            errors: unknownOperandCodes.map((oc) => ({
              lineItemCode: code,
              value: undefined,
              severity: 'ERROR' as const,
              message: `Computed rule ${code} refers to unknown line item code ${oc}.`,
              validationRule: rule,
            })),
          };
        }
        if (submittedOperands.length === 0) {
          return {
            errors: [
              {
                lineItemCode: code,
                value: undefined,
                severity: 'ERROR',
                message: `${code} cannot be computed because none of its source line items were submitted.`,
                validationRule: rule,
                submittedOperands: [],
              },
            ],
          };
        }
        return {
          value: submittedOperands.reduce((acc, o) => acc + o.value, 0),
          submittedCodes: submittedOperands.map((o) => o.code),
        };
      }
      case 'diff': {
        const { submittedOperands, unknownOperandCodes } = this.resolveStringOperands(
          rule.operands,
          lineItems,
          legendMap,
        );
        if (unknownOperandCodes.length > 0) {
          return {
            errors: unknownOperandCodes.map((oc) => ({
              lineItemCode: code,
              value: undefined,
              severity: 'ERROR' as const,
              message: `Computed rule ${code} refers to unknown line item code ${oc}.`,
              validationRule: rule,
            })),
          };
        }
        if (submittedOperands.length === 0) {
          return {
            errors: [
              {
                lineItemCode: code,
                value: undefined,
                severity: 'ERROR',
                message: `${code} cannot be computed because none of its source line items were submitted.`,
                validationRule: rule,
              },
            ],
          };
        }
        if (submittedOperands.length < 2) {
          return {
            errors: [
              {
                lineItemCode: code,
                value: undefined,
                severity: 'ERROR',
                message: `${code} diff requires at least 2 submitted operands to compute.`,
                validationRule: rule,
              },
            ],
          };
        }
        return {
          value: submittedOperands[0].value - submittedOperands.slice(1).reduce((acc, o) => acc + o.value, 0),
          submittedCodes: submittedOperands.map((o) => o.code),
        };
      }
      case 'linear': {
        for (const operand of rule.operands) {
          const sign = operand.sign as number;
          if (typeof operand.code !== 'string' || (sign !== 1 && sign !== -1)) {
            return {
              errors: [
                {
                  lineItemCode: code,
                  value: undefined,
                  severity: 'ERROR',
                  message: `${code} has a linear rule with an invalid operand shape.`,
                  validationRule: rule,
                },
              ],
            };
          }
        }
        const submittedLinearOperands: { code: string; value: number; sign: 1 | -1 }[] = [];
        const unknownLinearCodes: string[] = [];
        for (const operand of rule.operands) {
          if (!legendMap.has(operand.code)) {
            unknownLinearCodes.push(operand.code);
            continue;
          }
          if (!(operand.code in lineItems)) continue;
          const v = lineItems[operand.code];
          if (this.isFiniteNumber(v)) {
            submittedLinearOperands.push({ code: operand.code, value: v, sign: operand.sign });
          }
        }
        if (unknownLinearCodes.length > 0) {
          return {
            errors: unknownLinearCodes.map((oc) => ({
              lineItemCode: code,
              value: undefined,
              severity: 'ERROR' as const,
              message: `Computed rule ${code} refers to unknown line item code ${oc}.`,
              validationRule: rule,
            })),
          };
        }
        if (submittedLinearOperands.length === 0) {
          return {
            errors: [
              {
                lineItemCode: code,
                value: undefined,
                severity: 'ERROR',
                message: `${code} cannot be computed because none of its source line items were submitted.`,
                validationRule: rule,
              },
            ],
          };
        }
        return {
          value: submittedLinearOperands.reduce((acc, o) => acc + o.value * o.sign, 0),
          submittedCodes: submittedLinearOperands.map((o) => o.code),
        };
      }
      default:
        return {
          errors: [
            {
              lineItemCode: code,
              value: undefined,
              severity: 'ERROR',
              message: `${code} has an unsupported formula operation for computed validation.`,
              validationRule: rule,
            },
          ],
        };
    }
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
   * Validates a comparison rule against the submitted line item value.
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
    let passes: boolean;

    switch (operator) {
      case '<=':
        passes = value <= threshold;
        break;
      case '>=':
        passes = value >= threshold;
        break;
      case '===':
        passes = value === threshold;
        break;
      case '!==':
        passes = value !== threshold;
        break;
      case '<':
        passes = value < threshold;
        break;
      case '>':
        passes = value > threshold;
        break;
      default:
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

  /**
   * Counts submitted line items from payload.
   * @param lineItems Submitted line item map.
   * @returns Submitted line item count.
   */
  private getLineItemCount(lineItems: SubmittedLineItems): number {
    return Object.keys(lineItems).length;
  }

  /**
   * Gets changed line item codes between existing and incoming data.
   * A key is changed if it is new or its value differs from the stored value.
   * @param existing Existing sparse line item map.
   * @param incoming Incoming sparse line item map.
   * @returns Codes whose values changed.
   */
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
