import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { FilterQuery, Model } from 'mongoose';
import { RedisService } from 'src/core/services/redis/redis.service';
import { CreateLineItemsLegendDto } from './dto/create-line-items-legend.dto';
import { FinancialDataTemplateQueryDto } from './dto/financial-data-template-query.dto';
import { ImportLineItemsTemplateDto } from './dto/import-line-items-template.dto';
import { ListLineItemsLegendQueryDto } from './dto/list-line-items-legend-query.dto';
import { UpdateLineItemsLegendDto } from './dto/update-line-items-legend.dto';
import { LineItemsLegend, LineItemsLegendDocument } from './entities/line-items-legend.schema';
import {
  ACCOUNT_HEAD_VALUES,
  COMPARISON_OPERATORS,
  AccountHead,
  DEFAULT_TEMPLATE_VERSION,
  isComparisonOperator,
  isComputedLegendCode,
  parseRule,
  type ImportResult,
  type LineItemLegendForValidation,
  type RawLineItem,
  type Rule,
  type SanitizedLineItem,
} from './types';

const TEMPLATE_PROJECTION = '-_id -__v -createdAt -updatedAt -templateVersion' as const;
const VALIDATION_CACHE_PREFIX = 'line-items-legends:validation';

@Injectable()
export class LineItemsLegendService {
  private readonly logger = new Logger(LineItemsLegendService.name);

  constructor(
    @InjectModel(LineItemsLegend.name)
    private readonly legendModel: Model<LineItemsLegendDocument>,
    private readonly redisService: RedisService,
  ) {}

  /**
   * Fetches active line items for a template version.
   * Excludes computed legends — only normal financial line items are returned.
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
   * Fetches active legends for validation (both normal and computed).
   * Results are cached by templateVersion. Cache misses fall back to MongoDB.
   * @param templateVersion Template version to validate against.
   * @returns Active legend records for validation.
   */
  async getActiveLegendsForValidation(templateVersion: string): Promise<LineItemLegendForValidation[]> {
    const key = `${VALIDATION_CACHE_PREFIX}:${templateVersion}`;

    // Attempt cache read; fall through to MongoDB on any failure.
    try {
      const cached = await this.redisService.get(key);
      if (cached !== null) {
        return JSON.parse(cached) as LineItemLegendForValidation[];
      }
    } catch (err: unknown) {
      this.logger.warn(`Cache read failed for ${key}: ${String(err)}`);
    }

    // Cache miss — fetch from MongoDB.
    const legends = await this.legendModel
      .find({ templateVersion, isActive: true }, '-_id nmamCode name accountHead level parentCode rules isComputed')
      .lean<LineItemLegendForValidation[]>();

    // Populate cache; a write failure must not affect the caller.
    try {
      await this.redisService.set(key, legends);
    } catch (err: unknown) {
      this.logger.warn(`Cache write failed for ${key}: ${String(err)}`);
    }

    return legends;
  }

  /** Removes the validation cache entry for one template version. Logs and continues on failure. */
  private async invalidateValidationCache(templateVersion: string): Promise<void> {
    try {
      await this.redisService.del(`${VALIDATION_CACHE_PREFIX}:${templateVersion}`);
    } catch (err: unknown) {
      this.logger.warn(`Cache invalidation failed for templateVersion ${templateVersion}: ${String(err)}`);
    }
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
      const saved = await created.save();
      await this.invalidateValidationCache(dto.templateVersion);
      return saved;
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
    await this.invalidateValidationCache(templateVersion);
    return updated;
  }

  /**
   * Imports line item legends from request JSON.
   * Validates all records before bulk upsert.
   * Computed legends (isComputed: true) are validated for formula operand references
   * against both the import batch and active DB legends.
   * @param dto Import payload containing lineItems and dryRun flag.
   * @returns Validation summary on dry run, or write counts on actual import.
   * @throws BadRequestException if any record fails validation.
   */
  async importFromJson(dto: ImportLineItemsTemplateDto): Promise<ImportResult> {
    const templateVersion = dto.templateVersion ?? DEFAULT_TEMPLATE_VERSION;
    const dryRun = dto.dryRun ?? false;
    const total = dto.lineItems.length;

    // Step 1: synchronous shape/field validation
    const syncErrors = this.validateItems(dto.lineItems, templateVersion);
    if (syncErrors.length > 0) {
      throw new BadRequestException({
        message: 'Import validation failed',
        code: 'IMPORT_VALIDATION_FAILED',
        errors: syncErrors,
      });
    }

    // Step 2: async operand reference validation for computed legends
    const asyncErrors = await this.validateComputedOperandReferences(dto.lineItems, templateVersion);
    if (asyncErrors.length > 0) {
      throw new BadRequestException({
        message: 'Import validation failed',
        code: 'IMPORT_VALIDATION_FAILED',
        errors: asyncErrors,
      });
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
      await this.invalidateValidationCache(templateVersion);
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
   * Validates shape, required fields, and invariants for all import records.
   * Applies two distinct paths: strict hierarchy validation for normal items,
   * computed-specific validation for items with isComputed === true.
   * Does NOT make DB calls — only checks the batch itself and known constants.
   */
  private validateItems(items: RawLineItem[], templateVersion: string): string[] {
    const errors: string[] = [];
    const seenCodes = new Set<string>();
    const batchCodes = new Set<string>();

    for (const item of items) {
      const code = item['nmamCode'];
      if (typeof code === 'string' && code.trim()) {
        batchCodes.add(code);
      }
    }

    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      const label = `[${i}]`;
      const isComputed = item['isComputed'] === true;

      // ── Fields validated for both paths ──────────────────────────────────────

      const nmamCode = item['nmamCode'];
      const codeStr = typeof nmamCode === 'string' ? nmamCode.trim() : '';

      if (typeof nmamCode !== 'string' || !codeStr) {
        errors.push(`${label} missing or invalid 'nmamCode'`);
      } else {
        if (seenCodes.has(nmamCode)) errors.push(`${label} duplicate nmamCode '${nmamCode}'`);
        seenCodes.add(nmamCode);
      }

      const itemVersion = item['templateVersion'];
      if (itemVersion !== undefined && itemVersion !== templateVersion) {
        errors.push(`${label} templateVersion '${itemVersion as string}' does not match expected '${templateVersion}'`);
      }

      // ── isComputed === true: computed-record path ─────────────────────────────

      if (isComputed) {
        // nmamCode must be one of the supported computed codes
        if (codeStr && !isComputedLegendCode(codeStr)) {
          errors.push(`${label} isComputed legend must have nmamCode starting with 'computed.'`);
        }

        const accountHead = item['accountHead'];
        if (accountHead !== 'COMPUTED') {
          errors.push(`${label} isComputed legend must have accountHead 'COMPUTED'`);
        }

        for (const field of ['name', 'sortOrder'] as const) {
          if (item[field] === undefined || item[field] === null || item[field] === '') {
            errors.push(`${label} missing required field '${field}'`);
          }
        }

        const rules = item['rules'];
        if (!Array.isArray(rules) || (rules as unknown[]).length === 0) {
          errors.push(`${label} computed legend requires non-empty 'rules' array`);
        } else {
          // Validate each rule shape
          for (let j = 0; j < (rules as unknown[]).length; j++) {
            errors.push(...this.validateRuleShape((rules as unknown[])[j], `${label}.rules[${j}]`));
          }

          // Exactly one formula rule
          const formulaRules = (rules as unknown[]).filter(
            (r) => typeof r === 'object' && r !== null && (r as { type?: unknown }).type === 'formula',
          );
          if (formulaRules.length === 0) {
            errors.push(`${label} isComputed legend must have at least one formula rule`);
          } else if (formulaRules.length > 1) {
            errors.push(`${label} isComputed legend must have exactly one formula rule, found ${formulaRules.length}`);
          }

          // Validate formula operands: no computed-to-computed refs, no duplicates
          for (let j = 0; j < (rules as unknown[]).length; j++) {
            const rule = (rules as unknown[])[j];
            if (typeof rule !== 'object' || rule === null) continue;
            const r = rule as Record<string, unknown>;
            if (r['type'] !== 'formula' || !Array.isArray(r['operands'])) continue;
            const isLinear = r['operation'] === 'linear';
            const operands = r['operands'] as unknown[];
            const seenOperands = new Set<string>();

            for (let k = 0; k < operands.length; k++) {
              let operandCode: string | null = null;
              if (isLinear) {
                const op = operands[k];
                if (typeof op === 'object' && op !== null) {
                  const c = (op as Record<string, unknown>)['code'];
                  if (typeof c === 'string') operandCode = c;
                }
              } else {
                const c = operands[k];
                if (typeof c === 'string') operandCode = c;
              }
              if (operandCode === null) continue;

              if (operandCode.startsWith('computed.')) {
                errors.push(
                  `${label}.rules[${j}].operands[${k}] computed-to-computed reference '${operandCode}' is not allowed`,
                );
              }
              if (seenOperands.has(operandCode)) {
                errors.push(`${label}.rules[${j}].operands[${k}] duplicate operand '${operandCode}'`);
              }
              seenOperands.add(operandCode);
            }
          }
        }

        continue; // Skip normal-path checks for this item
      }

      // ── isComputed !== true: normal line-item path ────────────────────────────

      // Normal items must not use COMPUTED accountHead or computed.* prefix
      const accountHead = item['accountHead'];
      if (!ACCOUNT_HEAD_VALUES.includes(accountHead as never)) {
        errors.push(`${label} invalid accountHead '${accountHead as string}'`);
      } else if (accountHead === 'COMPUTED') {
        errors.push(`${label} normal line item must not use accountHead 'COMPUTED'`);
      }

      if (codeStr.startsWith('computed.')) {
        errors.push(`${label} nmamCode starting with 'computed.' requires isComputed: true`);
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
    }

    return errors;
  }

  /**
   * Validates that computed legend formula operands resolve to active normal legends.
   * Operands must exist either in the import batch or in the DB.
   * Computed-to-computed operand cycles are already rejected in validateItems.
   */
  private async validateComputedOperandReferences(items: RawLineItem[], templateVersion: string): Promise<string[]> {
    const computedItems = items.filter((item) => item['isComputed'] === true);
    if (computedItems.length === 0) return [];

    const errors: string[] = [];

    // Normal codes already in this batch (non-computed)
    const batchNormalCodes = new Set<string>();
    for (const item of items) {
      const code = item['nmamCode'];
      if (typeof code === 'string' && !code.startsWith('computed.')) {
        batchNormalCodes.add(code);
      }
    }

    // Collect all operand codes referenced by computed legends
    const allOperandCodes = new Set<string>();
    for (const item of computedItems) {
      const rules = item['rules'];
      if (!Array.isArray(rules)) continue;
      for (const rule of rules as unknown[]) {
        if (typeof rule !== 'object' || rule === null) continue;
        const r = rule as Record<string, unknown>;
        if (r['type'] !== 'formula' || !Array.isArray(r['operands'])) continue;
        const isLinear = r['operation'] === 'linear';
        for (const op of r['operands'] as unknown[]) {
          const code = isLinear
            ? typeof op === 'object' && op !== null
              ? ((op as Record<string, unknown>)['code'] as string | undefined)
              : undefined
            : typeof op === 'string'
              ? op
              : undefined;
          if (typeof code === 'string' && !code.startsWith('computed.')) {
            allOperandCodes.add(code);
          }
        }
      }
    }

    // Only look up DB for codes not already covered by the batch
    const codesNeedingDbCheck = [...allOperandCodes].filter((c) => !batchNormalCodes.has(c));
    const dbCodes = new Set<string>();

    if (codesNeedingDbCheck.length > 0) {
      const found = await this.legendModel
        .find({ templateVersion, nmamCode: { $in: codesNeedingDbCheck }, isActive: true })
        .select('nmamCode')
        .lean<{ nmamCode: string }[]>();
      for (const { nmamCode } of found) {
        dbCodes.add(nmamCode);
      }
    }

    for (const code of codesNeedingDbCheck) {
      if (!dbCodes.has(code)) {
        errors.push(
          `Computed formula references unknown operand '${code}': not found in import batch or active DB legends`,
        );
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
      if (!isComparisonOperator(r['operator'])) {
        errors.push(`${label} comparison operator must be one of ${COMPARISON_OPERATORS.join(', ')}`);
      }
      if (typeof r['value'] !== 'number' || !isFinite(r['value'])) {
        errors.push(`${label} comparison value must be a finite number`);
      }
    }
    return errors;
  }

  /**
   * Creates a clean plain-object copy of a rule, keeping only fields relevant to its type.
   * Used for DTO-typed inputs (createLegend, updateLegend) where the Rule type is already trusted.
   * For unknown import payloads, use parseRule() instead.
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

    await this.invalidateValidationCache(templateVersion);
    return { message: 'Line item legend deleted successfully.', deleted };
  }

  /**
   * Hard deletes one line item legend and all its descendants.
   * Descendants are all records whose codePath contains the given nmamCode.
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
    await this.invalidateValidationCache(templateVersion);

    return {
      message: 'Line item legend subtree deleted successfully.',
      deletedCount: legends.length,
      deleted: legends,
    };
  }

  /**
   * Sanitizes one import record for database write.
   * Parses rules type-safely using parseRule() — no unsafe assertions.
   * Computed records persist only applicable fields; hierarchy fields are omitted entirely.
   * @param item Validated source line item.
   * @param templateVersion Template version to store.
   * @returns Sanitized legend document payload.
   */
  private sanitizeItem(item: RawLineItem, templateVersion: string): SanitizedLineItem {
    const rawRules = item['rules'];
    const rules: Rule[] = Array.isArray(rawRules)
      ? (rawRules as unknown[]).map((r) => parseRule(r)).filter((r): r is Rule => r !== null)
      : [];
    const isActive = item['isActive'] === false ? false : true;

    if (item['isComputed'] === true) {
      return {
        nmamCode: item['nmamCode'] as string,
        accountHead: 'COMPUTED',
        name: item['name'] as string,
        desc: typeof item['desc'] === 'string' ? item['desc'] : '',
        sortOrder: item['sortOrder'] as number,
        isActive,
        rules,
        templateVersion,
        isComputed: true,
      };
    }

    return {
      nmamCode: item['nmamCode'] as string,
      accountHead: item['accountHead'] as Exclude<AccountHead, 'COMPUTED'>,
      majorCode: item['majorCode'] as string,
      parentCode: (item['parentCode'] as string | null) ?? null,
      segmentCode: item['segmentCode'] as string,
      segmentPath: item['segmentPath'] as string[],
      codePath: item['codePath'] as string[],
      name: item['name'] as string,
      desc: typeof item['desc'] === 'string' ? item['desc'] : '',
      level: item['level'] as number,
      sortOrder: item['sortOrder'] as number,
      isActive,
      rules,
      templateVersion,
      isComputed: false,
    };
  }
}
