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
import { Ulb, UlbDocument } from 'src/schemas/ulb.schema';
import { Year, YearDocument } from 'src/schemas/year.schema';
import type { DatacollectionRes, LineItemRules, LineItemsTemplate, Rule, ValidationErr } from './constant';
import { lineItems } from './constant';
import { DataCollectionDto } from './dto/data-collection.dto';
import {
  CODE,
  DataCollection,
  DataCollectionDocument,
  LineItemKey,
  LineItemsMap,
} from './entities/data-collection.schema';

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
  ) {}

  // TODO: do DB call.
  getFinancialDataTemplate() {
    return { lineItems, [CODE]: lineItems.map((i) => i[CODE]) };
  }

  async getUlbsList() {
    // TODO: get state id from token;
    // TODO: send consolidated code instead of censusCode and sbCode;
    const AP_ID = '5dcf9d7216a06aed41c748dd';
    try {
      return await this.ulbModel
        .find(
          {
            state: new Types.ObjectId(AP_ID),
            isActive: true,
          },
          {
            _id: 1,
            name: 1,
            censusCode: 1,
            sbCode: 1,
          },
        )
        .lean<UlbDocument[]>();
    } catch (error: unknown) {
      this.createErrorResponse(error, 'getYearsList');
    }
  }

  async getYearsList() {
    try {
      return await this.yearModel.find({ isActive: true }).lean<YearDocument[]>();
    } catch (error: unknown) {
      this.createErrorResponse(error, 'getYearsList');
    }
  }

  async create(payload: DataCollectionDto) {
    // TODO: validate if the ulb if from same state (token).
    const { ulbId, yearId, lineItems } = payload;

    // Fetch data of payload.ulbId for payload.yearId
    const data = await this.dataCollectionModel
      .findOne({
        ulbId: new Types.ObjectId(ulbId),
        yearId: new Types.ObjectId(yearId),
      })
      .lean<DataCollectionDocument>();

    // If data exists -> exit.
    if (data) {
      throw new ConflictException(
        `Data for ulbId: ${ulbId} and yearId: ${yearId} already exists. Try using PATCH method.`,
      );
    }

    // Get from template from DB - rename variable.
    // Build validation rules
    const lineItemsFromDB: LineItemsTemplate[] = this.getLineItemDetails();
    const lineItemRules: LineItemRules = this.getLineItemRules(lineItemsFromDB);

    // Validated data (payload.lineItems)
    const validationError: ValidationErr[] = this.validatePayloadData(lineItems, lineItemRules);

    try {
      // If payload.lineItems has error - return errors else save in DB.
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
          success: validationError.length === 0,
          errors: validationError,
          lineItems: lineItems,
        } as DatacollectionRes);
      }
    } catch (error: unknown) {
      this.createErrorResponse(error, 'create');
    }
  }

  async update(payload: DataCollectionDto) {
    // TODO: validate if the ulb if from same state (token).
    const { ulbId, yearId, lineItems } = payload;

    // Fetch existing document
    const existing = await this.dataCollectionModel.findOne({
      ulbId: new Types.ObjectId(ulbId),
      yearId: new Types.ObjectId(yearId),
    });

    if (!existing) {
      throw new NotFoundException(
        `Data for ulbId: ${ulbId} and yearId: ${yearId} does not exist. Try using POST method.`,
      );
    }

    // Merge old (from DB) + new lineItems
    const mergedLineItems: Record<string, number | null> = {
      ...Object.fromEntries(existing.lineItems),
    };

    // const invalidValues: ValidationErr[] = [];
    for (const [key, value] of Object.entries(lineItems)) {
      if (value === 0 || value) {
        mergedLineItems[key] = value;
      }
      // else {
      //   invalidValues.push(this.getInvalidValueErrObj(key));
      // }
    }

    // Build validation rules
    const template: LineItemsTemplate[] = this.getLineItemDetails();
    const lineItemRules: LineItemRules = this.getLineItemRules(template);

    // Validate merged object (IMPORTANT)
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

    // If valid -> assign + save
    existing.lineItems = new Map(Object.entries(mergedLineItems));

    try {
      const saved = await existing.save();
      return saved;
    } catch (error: unknown) {
      this.createErrorResponse(error, 'update');
    }
  }

  // TODO: Add DB call.
  private getLineItemDetails(): LineItemsTemplate[] {
    return lineItems;
  }

  /**
   * Helper: Extracts line item rules from database template array and organizes them by CODE.
   * @param lineItemsFromDB - Array of line item templates from the database
   * @returns An object mapping CF codes to their corresponding rules arrays
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
   * Helper: Handles and transforms errors into appropriate HTTP exceptions.
   *
   * @param error - The error object to be processed. Can be any type of error.
   * @throws {HttpException} If the error is already an HTTP exception, it is re-thrown as-is.
   * @throws {BadRequestException} If the error is a ValidationError, thrown when invalid keys exist in payload.lineItems.
   * @throws {InternalServerErrorException} For all other error types.
   * @private
   */
  private createErrorResponse(error: unknown, functionName: string) {
    this.logger.error(`${functionName}() Failed to perform operation`, error);

    // Preserve already thrown HTTP exception
    if (error instanceof HttpException) {
      throw error;
    }

    // Invalid key in payload.lineItems - thrown from validator in schema.
    if (error instanceof Error && error.name === 'ValidationError') {
      throw new BadRequestException(error.message);
    }

    throw new InternalServerErrorException('Something went wrong while creating DataCollection');
  }

  /**
   * Validates payload data against defined rules for line items.
   * @param lineItems - Map of line items with their values, keyed by CODE
   * @param rules - Rules to validate against, keyed by CODE
   * @returns Array of validation errors, if any. Returns empty array if validation passes
   * @description Iterates through line items and validates each against its corresponding rules.
   * Only validates line items that have values (including 0) and have associated rules defined.
   */
  private validatePayloadData(lineItems: LineItemsMap, rules: LineItemRules): ValidationErr[] {
    const errors: ValidationErr[] = [];
    for (const [lineItemCode, value] of Object.entries(lineItems)) {
      // Validate a lineItem only if value is avaialbe (can have 0) and rules are available.
      const rulesOfCurrLineItem = rules[lineItemCode];
      if ((value === 0 || value) && rulesOfCurrLineItem && rulesOfCurrLineItem.length) {
        // Validate all the rules.
        for (const rule of rulesOfCurrLineItem) {
          const errMsg = this.validateLineItem(rule, lineItemCode, value, lineItems);

          if (errMsg) {
            errors.push({
              lineItemCode,
              value,
              message: errMsg,
            });
          }
        }
      } else if (!value) {
        errors.push(this.getInvalidValueErrObj(CODE));
      }
    }
    return errors;
  }

  /**
   * Creates a validation error object for an invalid lineItemCode value.
   * @param lineItemCode - The line item key that failed validation
   * @returns A ValidationErr object containing the lineItemCode, null value, and error message
   */
  private getInvalidValueErrObj(lineItemCode: LineItemKey): ValidationErr {
    return {
      lineItemCode,
      value: null,
      message: `lineItemCode: ${lineItemCode} must be a valid number or null`,
    };
  }

  /**
   * Validates a line item value against a specified rule.
   *
   * @param rule - The validation rule to apply (formula or comparison type)
   * @param currLineItemCode - The current line item key identifier
   * @param value - The numeric value to validate
   * @param lineItems - Map of all line items used for formula operations
   *
   * @returns An error message string if validation fails, or null if validation passes
   *
   * @throws {BadRequestException} When rule operation or comparison operator is not supported
   *
   * @example
   * // Formula validation (sum)
   * const error = validateLineItem(
   *   { type: 'formula', operation: 'sum', operands: ['code1', 'code2'] },
   *   'totalCode',
   *   100,
   *   { code1: 50, code2: 50 }
   * ); // returns null (valid)
   *
   * @example
   * // Comparison validation (greater than)
   * const error = validateLineItem(
   *   { type: 'comparison', operator: '>', value: 50 },
   *   'amountCode',
   *   30,
   *   {}
   * ); // returns error message (invalid)
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
