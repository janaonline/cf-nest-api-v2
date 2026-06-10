import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { FilterQuery, Model } from 'mongoose';
import { CreateLineItemsLegendDto } from './dto/create-line-items-legend.dto';
import { FinancialDataTemplateQueryDto } from './dto/financial-data-template-query.dto';
import { ImportLineItemsTemplateDto } from './dto/import-line-items-template.dto';
import { ListLineItemsLegendQueryDto } from './dto/list-line-items-legend-query.dto';
import { UpdateLineItemsLegendDto } from './dto/update-line-items-legend.dto';
import { LineItemsLegend, LineItemsLegendDocument } from './entities/line-items-legend.schema';
import {
  ACCOUNT_HEAD_VALUES,
  AccountHead,
  DEFAULT_TEMPLATE_VERSION,
  type ImportResult,
  type LineItemLegendForValidation,
  type RawLineItem,
  type Rule,
  type SanitizedLineItem,
} from './types';

const TEMPLATE_PROJECTION = '-_id -__v -createdAt -updatedAt -templateVersion' as const;

@Injectable()
export class LineItemsLegendService {
  constructor(
    @InjectModel(LineItemsLegend.name)
    private readonly legendModel: Model<LineItemsLegendDocument>,
  ) {}

  /**
   * Fetches active line items for a template version.
   * Applies optional account head filtering.
   * @param query Template filter query.
   * @returns Template line items, codes, and account heads.
   */
  async getFinancialDataTemplate(query: FinancialDataTemplateQueryDto = {}) {
    const templateVersion = query.templateVersion ?? DEFAULT_TEMPLATE_VERSION;
    const filter: FilterQuery<LineItemsLegendDocument> = { templateVersion, isActive: true, isComputed: { $ne: true } };
    if (query.accountHead) {
      filter['accountHead'] = query.accountHead;
    }

    const lineItems = await this.legendModel
      .find(filter, TEMPLATE_PROJECTION)
      .sort({ sortOrder: 1 })
      .lean<LineItemsLegend[]>();

    const codes = lineItems.map((i) => i.nmamCode);
    const accountHeads = [...new Set(lineItems.map((i) => i.accountHead))];

    return { templateVersion, accountHeads, lineItems, codes };
  }

  /**
   * Fetches active legends for validation.
   * Selects only fields needed for key and rule checks.
   * @param templateVersion Template version to validate against.
   * @returns Active legend records for validation.
   */
  async getActiveLegendsForValidation(templateVersion: string): Promise<LineItemLegendForValidation[]> {
    return this.legendModel
      .find({ templateVersion, isActive: true }, '-_id nmamCode name accountHead level parentCode rules isComputed')
      .lean<LineItemLegendForValidation[]>();
  }

  /**
   * Lists line item legends with filters and pagination.
   * @param query Filter and pagination options.
   * @returns Paginated line item legend records.
   */
  async listLegends(query: ListLineItemsLegendQueryDto) {
    const { templateVersion, accountHead, majorCode, parentCode, level, isActive, search, page, limit } = query;
    const filter: FilterQuery<LineItemsLegendDocument> = { templateVersion };

    if (accountHead) filter['accountHead'] = accountHead;
    if (majorCode) filter['majorCode'] = majorCode;
    if (parentCode !== undefined) filter['parentCode'] = parentCode;
    if (level !== undefined) filter['level'] = level;
    if (isActive !== undefined) filter['isActive'] = isActive;
    if (search) filter['$or'] = [{ nmamCode: new RegExp(search, 'i') }, { name: new RegExp(search, 'i') }];

    const skip = (page - 1) * limit;
    const [data, total] = await Promise.all([
      this.legendModel.find(filter).sort({ sortOrder: 1 }).skip(skip).limit(limit).lean<LineItemsLegend[]>(),
      this.legendModel.countDocuments(filter),
    ]);

    return { data, total, page, limit };
  }

  /**
   * Fetches one line item legend by code and template version.
   * @param nmamCode Source-of-truth line item code.
   * @param templateVersion Template version to search within.
   * @returns Matching line item legend.
   * @throws NotFoundException if the legend does not exist.
   */
  async getLegend(nmamCode: string, templateVersion: string = DEFAULT_TEMPLATE_VERSION) {
    const legend = await this.legendModel.findOne({ nmamCode, templateVersion }).lean<LineItemsLegend | null>();
    if (!legend) throw new NotFoundException(`Line item '${nmamCode}' not found for version '${templateVersion}'`);
    return legend;
  }

  /**
   * Creates a line item legend manually.
   * @param dto Line item legend creation payload.
   * @returns Created line item legend document.
   * @throws ConflictException if a legend already exists for the same nmamCode and templateVersion.
   */
  async createLegend(dto: CreateLineItemsLegendDto) {
    const duplicate = await this.legendModel.exists({
      nmamCode: dto.nmamCode,
      templateVersion: dto.templateVersion,
    });
    if (duplicate) {
      throw new ConflictException('Line item legend already exists for this template version and nmamCode.');
    }
    const sanitizedRules = dto.rules?.map((r) => this.sanitizeRuleForStorage(r));
    const payload = sanitizedRules !== undefined ? { ...dto, rules: sanitizedRules } : dto;
    try {
      const created = new this.legendModel(payload);
      return await created.save();
    } catch (error) {
      if (this.isDuplicateKeyError(error)) {
        throw new ConflictException('Line item legend already exists for this template version and nmamCode.');
      }
      throw error;
    }
  }

  /**
   * Updates editable fields of an existing line item legend.
   * @param nmamCode Source-of-truth line item code.
   * @param templateVersion Template version to search within.
   * @param dto Editable line item legend fields.
   * @returns Updated line item legend.
   * @throws NotFoundException if the legend does not exist.
   */
  async updateLegend(
    nmamCode: string,
    templateVersion: string = DEFAULT_TEMPLATE_VERSION,
    dto: UpdateLineItemsLegendDto,
  ) {
    const sanitizedRules = dto.rules?.map((r) => this.sanitizeRuleForStorage(r));
    const setPayload = sanitizedRules !== undefined ? { ...dto, rules: sanitizedRules } : dto;
    const updated = await this.legendModel
      .findOneAndUpdate({ nmamCode, templateVersion }, { $set: setPayload }, { new: true })
      .lean<LineItemsLegend | null>();
    if (!updated) throw new NotFoundException(`Line item '${nmamCode}' not found for version '${templateVersion}'`);
    return updated;
  }

  /**
   * Imports line item legends from request JSON.
   * Validates all records before bulk upsert.
   * @param dto Import payload containing lineItems and dryRun flag.
   * @returns Validation summary on dry run, or write counts on actual import.
   * @throws BadRequestException if any record fails validation.
   */
  async importFromJson(dto: ImportLineItemsTemplateDto): Promise<ImportResult> {
    const templateVersion = dto.templateVersion ?? DEFAULT_TEMPLATE_VERSION;
    const dryRun = dto.dryRun ?? false;
    const total = dto.lineItems.length;

    const errors = this.validateItems(dto.lineItems, templateVersion);
    if (errors.length > 0) {
      throw new BadRequestException({ message: 'Import validation failed', errors });
    }

    if (dryRun) {
      return { dryRun: true, valid: true, total, templateVersion, wouldUpsert: total };
    }

    const ops = dto.lineItems.map((item) => {
      const sanitized = this.sanitizeItem(item, templateVersion);
      return {
        updateOne: {
          filter: { nmamCode: sanitized.nmamCode, templateVersion },
          update: { $set: sanitized },
          upsert: true,
        },
      };
    });

    try {
      const result = await this.legendModel.bulkWrite(ops as never, { ordered: false });
      return {
        dryRun: false,
        templateVersion,
        total,
        upserted: result.upsertedCount ?? 0,
        modified: result.modifiedCount ?? 0,
      };
    } catch (error) {
      if (this.isDuplicateKeyError(error)) {
        throw new ConflictException('Bulk import failed due to a duplicate key conflict.');
      }
      throw error;
    }
  }

  /**
   * Creates a clean plain-object copy of a rule, keeping only fields relevant to its type.
   * Prevents undefined/null fields from leaking into MongoDB via BSON serialisation.
   */
  private sanitizeRuleForStorage(rule: Rule): Rule {
    switch (rule.type) {
      case 'comparison':
        return { type: 'comparison', operator: rule.operator, value: rule.value };
      case 'formula': {
        switch (rule.operation) {
          case 'linear':
            return {
              type: 'formula',
              operation: 'linear',
              operands: rule.operands.map((op) => ({ code: op.code, sign: op.sign })),
            };
          case 'sum':
          case 'diff':
            return { type: 'formula', operation: rule.operation, operands: [...rule.operands] };
          default:
            throw new BadRequestException('Unsupported formula operation.');
        }
      }
      default:
        throw new BadRequestException('Unsupported rule type.');
    }
  }

  /** Returns true when the error is a MongoDB duplicate key error (code 11000). */
  private isDuplicateKeyError(error: unknown): boolean {
    return (
      typeof error === 'object' && error !== null && 'code' in error && (error as { code: unknown }).code === 11000
    );
  }

  /**
   * Hard deletes one line item legend by nmamCode and templateVersion.
   * Rejects deletion when child items still reference this legend.
   * @param nmamCode Source-of-truth line item code.
   * @param templateVersion Template version to delete from.
   * @returns Deleted document data and confirmation message.
   * @throws ConflictException if child items exist for this legend.
   * @throws NotFoundException if the legend does not exist.
   */
  async deleteLegend(nmamCode: string, templateVersion: string = DEFAULT_TEMPLATE_VERSION) {
    const hasChildren = await this.legendModel.exists({ templateVersion, parentCode: nmamCode });
    if (hasChildren) {
      throw new ConflictException(
        'Cannot delete a line item legend that has child items. Delete child items first or use subtree deletion.',
      );
    }

    const deleted = await this.legendModel
      .findOneAndDelete({ nmamCode, templateVersion }, { projection: { __v: 0 } })
      .lean<LineItemsLegend | null>();

    if (!deleted) {
      throw new NotFoundException('Line item legend not found.');
    }

    return { message: 'Line item legend deleted successfully.', deleted };
  }

  /**
   * Hard deletes one line item legend and all its descendants.
   * Descendants are all records whose codePath contains the given nmamCode.
   * Deletes only template metadata — does not touch submitted datacollections.
   * @param nmamCode Source-of-truth line item code (root of subtree).
   * @param templateVersion Template version to delete from.
   * @returns Deleted records, count, and confirmation message.
   * @throws NotFoundException if no matching legend exists.
   */
  async deleteLegendSubtree(nmamCode: string, templateVersion: string = DEFAULT_TEMPLATE_VERSION) {
    const legends = await this.legendModel
      .find({ templateVersion, codePath: nmamCode }, { __v: 0 })
      .sort({ sortOrder: 1 })
      .lean<LineItemsLegend[]>();

    if (!legends.length) {
      throw new NotFoundException('Line item legend not found.');
    }

    await this.legendModel.deleteMany({ templateVersion, codePath: nmamCode });

    return {
      message: 'Line item legend subtree deleted successfully.',
      deletedCount: legends.length,
      deleted: legends,
    };
  }

  /**
   * Validates submitted line item records before import.
   * Checks forbidden fields, duplicates, required fields, parent references, and code paths.
   * @param items Line items from the import payload.
   * @param templateVersion Template version used for validation.
   * @returns Array of error messages; empty if all records are valid.
   */
  private validateItems(items: RawLineItem[], templateVersion: string): string[] {
    const errors: string[] = [];
    const seenCodes = new Set<string>();
    const batchCodes = new Set<string>();

    // First pass: collect all valid nmamCodes for parentCode reference check
    for (const item of items) {
      const code = item['nmamCode'];
      if (typeof code === 'string' && code.trim()) {
        batchCodes.add(code);
      }
    }

    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      const label = `[${i}]`;

      const nmamCode = item['nmamCode'];
      if (typeof nmamCode !== 'string' || !nmamCode.trim()) {
        errors.push(`${label} missing or invalid 'nmamCode'`);
      } else {
        if (seenCodes.has(nmamCode)) {
          errors.push(`${label} duplicate nmamCode '${nmamCode}'`);
        }
        seenCodes.add(nmamCode);
      }

      const accountHead = item['accountHead'];
      if (!ACCOUNT_HEAD_VALUES.includes(accountHead as never)) {
        errors.push(`${label} invalid accountHead '${accountHead as string}'`);
      }

      for (const required of ['majorCode', 'segmentCode', 'name', 'level', 'sortOrder'] as const) {
        if (item[required] === undefined || item[required] === null || item[required] === '') {
          errors.push(`${label} missing required field '${required}'`);
        }
      }

      const segmentPath = item['segmentPath'];
      if (!Array.isArray(segmentPath) || segmentPath.length === 0) {
        errors.push(`${label} 'segmentPath' must be a non-empty array`);
      }

      const codePath = item['codePath'];
      if (!Array.isArray(codePath) || codePath.length === 0) {
        errors.push(`${label} 'codePath' must be a non-empty array`);
      } else if (typeof nmamCode === 'string' && codePath[codePath.length - 1] !== nmamCode) {
        errors.push(`${label} last element of 'codePath' must equal 'nmamCode'`);
      }

      const parentCode = item['parentCode'];
      if (parentCode !== null && parentCode !== undefined) {
        if (typeof parentCode !== 'string') {
          errors.push(`${label} 'parentCode' must be a string or null`);
        } else if (!batchCodes.has(parentCode)) {
          errors.push(`${label} 'parentCode' '${parentCode}' not found in import batch`);
        }
      }

      const itemVersion = item['templateVersion'];
      if (itemVersion !== undefined && itemVersion !== templateVersion) {
        errors.push(`${label} templateVersion '${itemVersion as string}' does not match expected '${templateVersion}'`);
      }

      const rules = item['rules'];
      if (rules !== undefined) {
        if (!Array.isArray(rules)) {
          errors.push(`${label} 'rules' must be an array`);
        } else {
          for (let j = 0; j < (rules as unknown[]).length; j++) {
            errors.push(...this.validateRuleShape((rules as unknown[])[j], `${label}.rules[${j}]`));
          }
        }
      }

      const isComputed = item['isComputed'];
      if (isComputed === true) {
        if (typeof nmamCode === 'string' && nmamCode.trim() && !nmamCode.startsWith('computed.')) {
          errors.push(`${label} isComputed legend must have nmamCode starting with 'computed.'`);
        }
        const hasFormulaRule =
          Array.isArray(rules) && (rules as unknown[]).some((r) => (r as { type?: unknown }).type === 'formula');
        if (!hasFormulaRule) {
          errors.push(`${label} isComputed legend must have at least one formula rule`);
        }
      }
    }

    return errors;
  }

  /** Validates the shape of a single rule object from an import payload. */
  private validateRuleShape(rule: unknown, label: string): string[] {
    const errors: string[] = [];
    if (typeof rule !== 'object' || rule === null) {
      errors.push(`${label} must be an object`);
      return errors;
    }
    const r = rule as Record<string, unknown>;
    if (r['type'] !== 'formula' && r['type'] !== 'comparison') {
      errors.push(`${label} type must be 'formula' or 'comparison', got '${String(r['type'])}'`);
      return errors;
    }
    if (r['type'] === 'formula') {
      if (!['sum', 'diff', 'linear'].includes(r['operation'] as string)) {
        errors.push(`${label} formula operation must be 'sum', 'diff', or 'linear'`);
      }
      if ('linearOperands' in r) {
        errors.push(`${label} use 'operands' not 'linearOperands'`);
      }
      const operands = r['operands'];
      if (!Array.isArray(operands) || (operands as unknown[]).length === 0) {
        errors.push(`${label} formula operands must be a non-empty array`);
      } else if (r['operation'] === 'linear') {
        for (let i = 0; i < (operands as unknown[]).length; i++) {
          const op = (operands as unknown[])[i] as Record<string, unknown>;
          if (
            typeof op !== 'object' ||
            op === null ||
            typeof op['code'] !== 'string' ||
            (op['sign'] !== 1 && op['sign'] !== -1)
          ) {
            errors.push(`${label} operands[${i}] must be { code: string; sign: 1 | -1 }`);
          }
        }
      } else {
        for (let i = 0; i < (operands as unknown[]).length; i++) {
          if (typeof (operands as unknown[])[i] !== 'string') {
            errors.push(`${label} operands[${i}] must be a string`);
          }
        }
      }
    }
    if (r['type'] === 'comparison') {
      const validOperators = ['<=', '>=', '===', '!==', '<', '>'];
      if (!validOperators.includes(r['operator'] as string)) {
        errors.push(`${label} comparison operator must be one of ${validOperators.join(', ')}`);
      }
      if (typeof r['value'] !== 'number' || !isFinite(r['value'])) {
        errors.push(`${label} comparison value must be a finite number`);
      }
    }
    return errors;
  }

  /**
   * Sanitizes one import record for database write.
   * Keeps only fields allowed in lineitemslegends.
   * @param item Validated source line item.
   * @param templateVersion Template version to store.
   * @returns Sanitized legend document payload.
   */
  private sanitizeItem(item: RawLineItem, templateVersion: string): SanitizedLineItem {
    return {
      nmamCode: item['nmamCode'] as string,
      accountHead: item['accountHead'] as AccountHead,
      majorCode: item['majorCode'] as string,
      parentCode: (item['parentCode'] as string | null) ?? null,
      segmentCode: item['segmentCode'] as string,
      segmentPath: item['segmentPath'] as string[],
      codePath: item['codePath'] as string[],
      name: item['name'] as string,
      desc: (item['desc'] as string) ?? '',
      level: item['level'] as number,
      sortOrder: item['sortOrder'] as number,
      isActive: (item['isActive'] as boolean) ?? true,
      rules: ((item['rules'] as Rule[]) ?? []).map((r) => this.sanitizeRuleForStorage(r)),
      templateVersion,
      isComputed: (item['isComputed'] as boolean) ?? false,
    };
  }
}
