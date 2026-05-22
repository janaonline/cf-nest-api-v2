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
import type { DataCollectionValidationIssue, DataCollectionValidationResult } from '../types';
import { DataCollectionAuthorizationService } from './data-collection-authorization.service';

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
  ) {}

  /** Returns the current financial data template from DB. */
  getFinancialDataTemplate(query: FinancialDataTemplateQueryDto = {}) {
    return this.lineItemsLegendService.getFinancialDataTemplate(query);
  }

  /**
   * Returns ULBs accessible by the API client.
   * STATE clients see all active ULBs in their state.
   * ULB clients see only their own ULB.
   */
  async getUlbsList(client: ApiClientContext) {
    try {
      const filter = this.authorizationService.getAllowedUlbFilter(client);
      return await this.ulbModel.find(filter, { _id: 1, name: 1, censusCode: 1, sbCode: 1 }).lean<UlbDocument[]>();
    } catch (error: unknown) {
      this.createErrorResponse(error, 'getUlbsList');
    }
  }

  /** Returns all active financial years. */
  async getYearsList() {
    try {
      return await this.yearModel.find({ isActive: true }).lean<YearDocument[]>();
    } catch (error: unknown) {
      this.createErrorResponse(error, 'getYearsList');
    }
  }

  /**
   * Submits new financial data for a ULB and year.
   * Sparse lineItems are allowed — only submitted keys are stored.
   * All submitted keys must be valid nmamCodes. Submitted parents must equal
   * the sum of their submitted operands. Throws BadRequestException on any error.
   */
  async create(payload: DataCollectionDto, client: ApiClientContext) {
    const { ulbId, yearId, lineItems: payloadLineItems } = payload;
    const templateVersion = payload.templateVersion ?? DEFAULT_TEMPLATE_VERSION;

    await this.authorizationService.validateCanSubmitForUlb(client, ulbId);

    const existing = await this.dataCollectionModel
      .findOne({ ulbId: new Types.ObjectId(ulbId), yearId: new Types.ObjectId(yearId) })
      .lean<DataCollectionDocument>();

    if (existing) {
      throw new ConflictException(
        `Data for ulbId: ${ulbId} and yearId: ${yearId} already exists. Try using PATCH method.`,
      );
    }

    const legends = await this.lineItemsLegendService.getActiveLegendsForValidation(templateVersion);
    const legendMap = new Map(legends.map((l) => [l.nmamCode, l]));
    const result = this.validateLineItemsAgainstTemplate(payloadLineItems, legendMap, templateVersion);

    if (result.hasErrors) {
      throw new BadRequestException({
        ulbId,
        yearId,
        templateVersion,
        success: false,
        errors: result.errors,
        lineItems: payloadLineItems,
      });
    }

    try {
      const created = new this.dataCollectionModel({
        ulbId: new Types.ObjectId(ulbId),
        yearId: new Types.ObjectId(yearId),
        templateVersion,
        lineItems: payloadLineItems,
        validationStatus: 'VALID',
      });
      const data = await created.save();
      return { success: true as const, validationStatus: 'VALID' as const, data };
    } catch (error: unknown) {
      this.createErrorResponse(error, 'create');
    }
  }

  /**
   * Updates existing financial data for a ULB and year.
   * Merges existing lineItems with incoming, then validates the merged set.
   * Sparse merged data is allowed; submitted parents must equal their submitted operand sums.
   */
  async update(payload: DataCollectionDto, client: ApiClientContext) {
    const { ulbId, yearId, lineItems: payloadLineItems } = payload;

    await this.authorizationService.validateCanModifyForUlb(client, ulbId);

    const existing = await this.dataCollectionModel.findOne({
      ulbId: new Types.ObjectId(ulbId),
      yearId: new Types.ObjectId(yearId),
    });

    if (!existing) {
      throw new NotFoundException(
        `Data for ulbId: ${ulbId} and yearId: ${yearId} does not exist. Try using POST method.`,
      );
    }

    const existingTemplateVersion = existing.templateVersion ?? DEFAULT_TEMPLATE_VERSION;
    if (payload.templateVersion && payload.templateVersion !== existingTemplateVersion) {
      throw new BadRequestException('templateVersion cannot be changed for an existing data collection record.');
    }
    const templateVersion = existingTemplateVersion;

    // Unconditional merge — null from payload is intentional, validation decides validity.
    const mergedLineItems: Record<string, unknown> = Object.fromEntries(existing.lineItems) as Record<string, unknown>;
    for (const [key, value] of Object.entries(payloadLineItems)) {
      mergedLineItems[key] = value;
    }

    const legends = await this.lineItemsLegendService.getActiveLegendsForValidation(templateVersion);
    const legendMap = new Map(legends.map((l) => [l.nmamCode, l]));
    const result = this.validateLineItemsAgainstTemplate(mergedLineItems, legendMap, templateVersion);

    if (result.hasErrors) {
      throw new BadRequestException({
        ulbId,
        yearId,
        templateVersion,
        success: false,
        errors: result.errors,
        lineItems: mergedLineItems,
      });
    }

    existing.templateVersion = templateVersion;
    existing.lineItems = new Map(Object.entries(mergedLineItems) as [string, number | null][]);
    existing.validationStatus = 'VALID';

    try {
      const data = await existing.save();
      return { success: true as const, validationStatus: 'VALID' as const, data };
    } catch (error: unknown) {
      this.createErrorResponse(error, 'update');
    }
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

  /** Transforms any error into an appropriate HTTP exception and re-throws. */
  private createErrorResponse(error: unknown, functionName: string): never {
    this.logger.error(`${functionName}() Failed to perform operation`, error);
    if (error instanceof HttpException) throw error;
    if (error instanceof Error && error.name === 'ValidationError') throw new BadRequestException(error.message);
    throw new InternalServerErrorException('Something went wrong while processing DataCollection');
  }
}
