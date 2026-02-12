import {
  BadRequestException,
  ConflictException,
  HttpException,
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Ulb, UlbDocument } from 'src/schemas/ulb.schema';
import { Year, YearDocument } from 'src/schemas/year.schema';
import type { DatacollectionRes, LineItemRules, Rule, ValidationErr } from './constant';
import { lineItems } from './constant';
import { CreateDataCollectionDto } from './dto/create-data-collection.dto';
import { UpdateDataCollectionDto } from './dto/update-data-collection.dto';
import { DataCollection, DataCollectionDocument, LineItemKey, LineItemsMap } from './entities/data-collection.schema';

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

  getFinancialDataTemplate() {
    return `This action returns financial data template`;
  }

  getUlbsList() {
    return `This action returns list of ulbs from the state`;
  }

  getYearsList() {
    return `This action returns list of years`;
  }

  async create(payload: CreateDataCollectionDto) {
    // TODO: validate if the ulb if from same state (token).
    // Fetch data of payload.ulbId for payload.yearId
    const data = await this.dataCollectionModel
      .findOne({
        ulbId: new Types.ObjectId(payload.ulbId),
        yearId: new Types.ObjectId(payload.yearId),
      })
      .lean<DataCollectionDocument>();

    // If data exists -> exit.
    if (data) {
      throw new ConflictException(
        `Data for ulbId: ${payload.ulbId} and yearId: ${payload.yearId} already exists. Try using PUT/ POST method.`,
      );
    }

    // Validated data (payload.lineItems)
    // Get from template from DB - rename variable.
    const lineItemsFromDB = lineItems;
    const lineItemRules: LineItemRules = {};
    for (const item of lineItemsFromDB) {
      if (item.rules && item.rules.length > 0) {
        lineItemRules[item.cfCode] = item.rules;
      }
    }
    const validationError: ValidationErr[] = this.validatePayloadData(payload.lineItems, lineItemRules);

    try {
      // If payload.lineItems has error - return errors else save in DB.
      if (validationError.length === 0) {
        const created = new this.dataCollectionModel({
          ...payload,
          ulbId: new Types.ObjectId(payload.ulbId),
          yearId: new Types.ObjectId(payload.yearId),
        });
        return await created.save();
      } else {
        return {
          ulbId: payload.ulbId,
          yearId: payload.yearId,
          success: validationError.length === 0,
          errors: validationError,
          lineItems: payload.lineItems,
        } as DatacollectionRes;
      }
    } catch (error: unknown) {
      this.logger.error('Failed to create entry in DataCollection model.', error);

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
  }

  update(updateDataCollectionDto: UpdateDataCollectionDto) {
    return { message: `This action updates existing dataCollection`, updateDataCollectionDto };
  }

  private validatePayloadData(lineItems: LineItemsMap, rules: LineItemRules): ValidationErr[] {
    const errors: ValidationErr[] = [];
    for (const [cfCode, value] of Object.entries(lineItems)) {
      // Validate a lineItem only if value is avaialbe (can have 0) and rules are available.
      const rulesOfCurrLineItem = rules[cfCode];
      if ((value === 0 || value) && rulesOfCurrLineItem && rulesOfCurrLineItem.length) {
        // Validate all the rules.
        for (const rule of rulesOfCurrLineItem) {
          const errMsg = this.validateLineItem(rule, cfCode, value, lineItems);

          if (errMsg) {
            errors.push({
              cfCode,
              value,
              message: errMsg,
            });
          }
        }
      }
    }
    return errors;
  }

  private validateLineItem(
    rule: Rule,
    currItemCfcode: LineItemKey,
    value: number,
    lineItems: LineItemsMap,
  ): string | null {
    if (!rule) return null;

    if (rule.type === 'formula') {
      switch (rule.operation) {
        case 'sum': {
          let sumValue = 0;

          for (const cfCode of rule.operands) {
            const operandValue = lineItems[cfCode];

            if (operandValue === 0 || operandValue) {
              sumValue += operandValue;
            }
          }

          return value !== sumValue
            ? `cfCode: ${currItemCfcode} must equal sum of ${rule.operands.join(', ')}. Expected: ${sumValue}, Received: ${value}`
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
          return value > compareValue ? null : `${currItemCfcode} must be greater than ${compareValue}`;

        case '<':
          return value < compareValue ? null : `${currItemCfcode} must be less than ${compareValue}`;

        case '>=':
          return value >= compareValue ? null : `${currItemCfcode} must be ≥ ${compareValue}`;

        case '<=':
          return value <= compareValue ? null : `${currItemCfcode} must be ≤ ${compareValue}`;

        case '===':
          return value === compareValue ? null : `${currItemCfcode} must equal ${compareValue}`;

        default:
          throw new BadRequestException(`Comparator not supported`);
      }
    }

    return null;
  }
}
