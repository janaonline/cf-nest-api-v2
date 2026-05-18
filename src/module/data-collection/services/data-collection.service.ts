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
import { Ulb, UlbDocument } from 'src/schemas/ulb.schema';
import { Year, YearDocument } from 'src/schemas/year.schema';
import type { DatacollectionRes, LineItemRules, LineItemsTemplate, Rule, ValidationErr } from '../constant';
import { lineItems } from '../constant';
import { DataCollectionDto } from '../dto/data-collection.dto';
import {
  CODE,
  DataCollection,
  DataCollectionDocument,
  LineItemKey,
  LineItemsMap,
} from '../entities/data-collection.schema';
import { DataCollectionAuthorizationService } from './data-collection-authorization.service';

@Injectable()
export class DataCollectionService {
  private logger = new Logger(DataCollectionService.name);

  constructor(
    @InjectModel(DataCollection.name)
    private readonly dataCollectionModel: Model<DataCollectionDocument>,

    @InjectModel(Ulb.name)
    private readonly ulbModel: Model<UlbDocument>,

    @InjectModel(Year.name)
    private readonly yearModel: Model<YearDocument>,

    private readonly authorizationService: DataCollectionAuthorizationService,
  ) {}

  /** Returns the current financial data template with line items and codes. */
  getFinancialDataTemplate() {
    return { lineItems, [CODE]: lineItems.map((i) => i[CODE]) };
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
   * Submits financial data for a ULB and year.
   * Validates client ownership before writing.
   * @param payload Submission payload.
   * @param client Authenticated API client context.
   */
  async create(payload: DataCollectionDto, client: ApiClientContext) {
    const { ulbId, yearId, lineItems: payloadLineItems } = payload;

    await this.authorizationService.validateCanSubmitForUlb(client, ulbId);

    const data = await this.dataCollectionModel
      .findOne({
        ulbId: new Types.ObjectId(ulbId),
        yearId: new Types.ObjectId(yearId),
      })
      .lean<DataCollectionDocument>();

    if (data) {
      throw new ConflictException(
        `Data for ulbId: ${ulbId} and yearId: ${yearId} already exists. Try using PATCH method.`,
      );
    }

    const lineItemsFromDB: LineItemsTemplate[] = this.getLineItemDetails();
    const lineItemRules: LineItemRules = this.getLineItemRules(lineItemsFromDB);
    const validationError: ValidationErr[] = this.validatePayloadData(payloadLineItems, lineItemRules);

    try {
      if (validationError.length === 0) {
        const created = new this.dataCollectionModel({
          ...payload,
          ulbId: new Types.ObjectId(ulbId),
          yearId: new Types.ObjectId(yearId),
        });
        return await created.save();
      } else {
        throw new BadRequestException({
          ulbId,
          yearId,
          success: false,
          errors: validationError,
          lineItems: payloadLineItems,
        } as DatacollectionRes);
      }
    } catch (error: unknown) {
      this.createErrorResponse(error, 'create');
    }
  }

  /**
   * Updates existing financial data for a ULB and year.
   * Merges incoming line items with stored values after ownership check.
   * @param payload Update payload.
   * @param client Authenticated API client context.
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

    const mergedLineItems: Record<string, number | null> = {
      ...Object.fromEntries(existing.lineItems),
    };

    for (const [key, value] of Object.entries(payloadLineItems)) {
      if (value === 0 || value) {
        mergedLineItems[key] = value;
      }
    }

    const template: LineItemsTemplate[] = this.getLineItemDetails();
    const lineItemRules: LineItemRules = this.getLineItemRules(template);
    const validationError: ValidationErr[] = this.validatePayloadData(mergedLineItems, lineItemRules);

    if (validationError.length > 0) {
      throw new BadRequestException({
        ulbId,
        yearId,
        success: false,
        errors: validationError,
        lineItems: mergedLineItems,
      } as DatacollectionRes);
    }

    existing.lineItems = new Map(Object.entries(mergedLineItems));

    try {
      return await existing.save();
    } catch (error: unknown) {
      this.createErrorResponse(error, 'update');
    }
  }

  private getLineItemDetails(): LineItemsTemplate[] {
    return lineItems;
  }

  /**
   * Extracts validation rules from a template array, keyed by nmamCode.
   * @param lineItemsFromDB Template array.
   * @returns Rules map keyed by code.
   */
  private getLineItemRules(lineItemsFromDB: LineItemsTemplate[]): LineItemRules {
    const lineItemRules: LineItemRules = {};
    for (const item of lineItemsFromDB) {
      if (item.rules && item.rules.length > 0) {
        lineItemRules[item[CODE]] = item.rules;
      }
    }
    return lineItemRules;
  }

  /**
   * Handles and transforms errors into appropriate HTTP exceptions.
   */
  private createErrorResponse(error: unknown, functionName: string) {
    this.logger.error(`${functionName}() Failed to perform operation`, error);

    if (error instanceof HttpException) {
      throw error;
    }

    if (error instanceof Error && error.name === 'ValidationError') {
      throw new BadRequestException(error.message);
    }

    throw new InternalServerErrorException('Something went wrong while processing DataCollection');
  }

  /**
   * Validates payload line items against their rules.
   * @param lineItems Line items to validate.
   * @param rules Rules map keyed by code.
   * @returns Array of validation errors.
   */
  private validatePayloadData(lineItems: LineItemsMap, rules: LineItemRules): ValidationErr[] {
    const errors: ValidationErr[] = [];

    for (const [lineItemCode, value] of Object.entries(lineItems)) {
      const rulesOfCurrLineItem = rules[lineItemCode];
      if ((value === 0 || value) && rulesOfCurrLineItem && rulesOfCurrLineItem.length) {
        for (const rule of rulesOfCurrLineItem) {
          const errMsg = this.validateLineItem(rule, lineItemCode, value, lineItems);
          if (errMsg) {
            errors.push({ lineItemCode, value, message: errMsg });
          }
        }
      } else if (!value) {
        errors.push(this.getInvalidValueErrObj(lineItemCode));
      }
    }

    return errors;
  }

  /**
   * Creates a validation error object for an invalid lineItemCode value.
   */
  private getInvalidValueErrObj(lineItemCode: LineItemKey): ValidationErr {
    return {
      lineItemCode,
      value: null,
      message: `lineItemCode: ${lineItemCode} must be a valid number or null`,
    };
  }

  /**
   * Validates a single line item value against a rule.
   */
  private validateLineItem(
    rule: Rule,
    currLineItemCode: LineItemKey,
    value: number,
    lineItems: LineItemsMap,
  ): string | null {
    if (!rule) return null;

    if (rule.type === 'formula') {
      switch (rule.operation) {
        case 'sum': {
          let sumValue = 0;
          for (const lineItemCode of rule.operands) {
            const operandValue = lineItems[lineItemCode];
            if (operandValue === 0 || operandValue) {
              sumValue += operandValue;
            }
          }
          return value !== sumValue
            ? `lineItemCode: ${currLineItemCode} must equal sum of ${rule.operands.join(', ')}. Expected: ${sumValue}, Received: ${value}`
            : null;
        }
        default:
          throw new BadRequestException(`Operation ${rule.operation} not supported`);
      }
    }

    if (rule.type === 'comparison') {
      const compareValue = rule.value;
      switch (rule.operator) {
        case '>':
          return value > compareValue ? null : `lineItemCode: ${currLineItemCode} must be greater than ${compareValue}`;
        case '<':
          return value < compareValue ? null : `lineItemCode: ${currLineItemCode} must be less than ${compareValue}`;
        case '>=':
          return value >= compareValue ? null : `lineItemCode: ${currLineItemCode} must be ≥ ${compareValue}`;
        case '<=':
          return value <= compareValue ? null : `lineItemCode: ${currLineItemCode} must be ≤ ${compareValue}`;
        case '===':
          return value === compareValue ? null : `lineItemCode: ${currLineItemCode} must equal ${compareValue}`;
        default:
          throw new BadRequestException(`Comparator not supported`);
      }
    }

    return null;
  }
}
