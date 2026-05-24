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
import type { FinancialDataTemplateQueryDto } from 'src/module/line-items-legends/dto/financial-data-template-query.dto';
import { LineItemsLegendService } from 'src/module/line-items-legends/line-items-legend.service';
import { DEFAULT_TEMPLATE_VERSION, type LineItemLegendForValidation } from 'src/module/line-items-legends/types';
import { Ulb, UlbDocument } from 'src/schemas/ulb.schema';
import { Year, YearDocument } from 'src/schemas/year.schema';
import { DataCollectionDto } from '../dto/data-collection.dto';
import { DataCollection, DataCollectionDocument } from '../entities/data-collection.schema';
import type {
  DataCollectionRequestMeta,
  DataCollectionValidationIssue,
  DataCollectionValidationResult,
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

    const existing = await this.dataCollectionModel.findOne({ ulbId, yearId }).lean<DataCollectionDocument>();

    const apiClientId = this.getApiClientObjectId(client);

    if (existing) {
      await this.auditLogService.logDuplicateSubmit({
        apiClientId,
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
        ulbId,
        stateId,
        yearId,
        yearCode: resolvedYearCode,
        templateVersion,
        lineItems: payloadLineItems,
        validationStatus: 'VALID',
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

    const existing = await this.dataCollectionModel.findOne({ ulbId, yearId });

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
  private mapToExternalDataCollectionResponse(data: DataCollectionDocument, ulbCode: string, yearCode: string) {
    return {
      ulbCode,
      yearCode,
      templateVersion: data.templateVersion,
      validationStatus: data.validationStatus,
      lineItems: Object.fromEntries(data.lineItems),
      createdAt: data.createdAt,
      updatedAt: data.updatedAt,
    };
  }

  /**
   * Pass 1: validates each submitted key and value against the template.
   * Pass 2: validates sparse formula rules (submitted parent must equal submitted operand sum).
   */
  private validateLineItemsAgainstTemplate(
    lineItems: Record<string, unknown>,
    legendMap: Map<string, LineItemLegendForValidation>,
    templateVersion: string,
  ): DataCollectionValidationResult {
    const errors: DataCollectionValidationIssue[] = [];

    for (const [code, value] of Object.entries(lineItems)) {
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

    errors.push(...this.validateFormulaRules(lineItems, legendMap));

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

  /**
   * Sparse formula validation: runs only when the parent is present in lineItems.
   * Missing operands are ignored. If no operands are submitted at all, that is an error.
   * If any operand is referenced but absent from the template, that is a template integrity error.
   * All operand codes not in legendMap are reported; then sum check is skipped for that rule.
   */
  private validateFormulaRules(
    lineItems: Record<string, unknown>,
    legendMap: Map<string, LineItemLegendForValidation>,
  ): DataCollectionValidationIssue[] {
    const errors: DataCollectionValidationIssue[] = [];

    for (const legend of legendMap.values()) {
      if (!legend.rules.length) continue;
      if (!(legend.nmamCode in lineItems)) continue;

      const parentValue = lineItems[legend.nmamCode];

      for (const rule of legend.rules) {
        if (rule.type !== 'formula') continue;

        switch (rule.operation) {
          case 'sum': {
            const submittedOperands: string[] = [];
            let sum = 0;
            let hasTemplateError = false;

            const numericParent = typeof parentValue === 'number' && isFinite(parentValue) ? parentValue : null;
            const ruleSnapshot = { type: rule.type, operation: rule.operation, operands: [...rule.operands] };

            for (const operandCode of rule.operands) {
              if (!legendMap.has(operandCode)) {
                errors.push({
                  lineItemCode: legend.nmamCode,
                  value: parentValue,
                  severity: 'ERROR',
                  message: `Formula rule for lineItemCode: ${legend.nmamCode} refers to unknown operand ${operandCode}.`,
                  validationRule: ruleSnapshot,
                  submittedOperands: [...submittedOperands],
                  expected: null,
                  received: numericParent,
                });
                hasTemplateError = true;
                continue;
              }

              if (!(operandCode in lineItems)) continue; // sparse — skip missing

              submittedOperands.push(operandCode);
              const v = lineItems[operandCode];
              if (typeof v === 'number' && isFinite(v)) sum += v;
              // invalid values are already caught by pass 1
            }

            if (hasTemplateError) break;

            if (submittedOperands.length === 0) {
              errors.push({
                lineItemCode: legend.nmamCode,
                value: parentValue,
                severity: 'ERROR',
                message: `lineItemCode: ${legend.nmamCode} cannot be validated because none of its operands were submitted.`,
                validationRule: ruleSnapshot,
                submittedOperands: [],
                expected: null,
                received: numericParent,
              });
              break;
            }

            if (typeof parentValue === 'number' && isFinite(parentValue) && parentValue !== sum) {
              errors.push({
                lineItemCode: legend.nmamCode,
                value: parentValue,
                severity: 'ERROR',
                message: `lineItemCode: ${legend.nmamCode} must equal sum of submitted operands ${submittedOperands.join(', ')}. Expected: ${sum}, Received: ${parentValue}.`,
                validationRule: ruleSnapshot,
                submittedOperands: [...submittedOperands],
                expected: sum,
                received: parentValue,
              });
            }
            break;
          }
          default:
            errors.push({
              lineItemCode: legend.nmamCode,
              value: parentValue,
              severity: 'ERROR',
              message: `Unsupported validation rule for lineItemCode: ${legend.nmamCode}.`,
              validationRule: rule,
            });
        }
      }
    }

    return errors;
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
