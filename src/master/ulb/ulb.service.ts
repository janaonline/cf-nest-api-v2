import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { MongoServerError } from 'mongodb';
import { FilterQuery, Model, Types } from 'mongoose';
import { DynamicFormValidationService } from 'src/module/xvi-fc/common/dynamic-form-validation/dynamic-form-validation.service';
import type { XviFcValidationErrorMap } from 'src/module/xvi-fc/common/response/xvi-fc-api-response';
import type { FieldConfig } from 'src/module/xvi-fc/common/types/field-config.type';
import { FormJsonService } from 'src/form-json/form-json.service';
import { Ulb, UlbDocument } from 'src/schemas/ulb.schema';
import { DEFAULT_ULB_FIELDS, ULB_FORM_JSON_TYPE } from './constants/ulb-form.constants';
import { CreateUlbDto } from './dto/create-ulb.dto';
import { QueryUlbDto } from './dto/query-ulb.dto';
import { UpdateUlbDto } from './dto/update-ulb.dto';

const OBJECT_ID_FIELDS = new Set(['state', 'ulbType', 'UA']);

@Injectable()
export class UlbService {
  private readonly logger = new Logger(UlbService.name);

  constructor(
    @InjectModel(Ulb.name) private readonly ulbModel: Model<UlbDocument>,
    private readonly formJsonService: FormJsonService,
    private readonly dynamicFormValidation: DynamicFormValidationService,
  ) {}

  /** Loads the admin-configurable ULB field definition, falling back to the built-in defaults. */
  private async loadFields(): Promise<FieldConfig[]> {
    try {
      const formJson = await this.formJsonService.findByType(ULB_FORM_JSON_TYPE);
      return formJson.data?.length ? formJson.data : DEFAULT_ULB_FIELDS;
    } catch {
      return DEFAULT_ULB_FIELDS;
    }
  }

  private throwValidationError(errors: XviFcValidationErrorMap): never {
    throw new BadRequestException({ message: 'Validation failed', errors });
  }

  /** Converts a sanitized dynamic-form payload into a typed Mongo patch (ObjectId coercion for ref fields). */
  private toMongoPatch(sanitizedPayload: Record<string, unknown>): Record<string, unknown> {
    const patch: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(sanitizedPayload)) {
      if (value === undefined) continue;
      patch[key] = OBJECT_ID_FIELDS.has(key) && typeof value === 'string' ? new Types.ObjectId(value) : value;
    }
    return patch;
  }

  private buildSlug(name: string): string {
    return name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-+|-+$)/g, '');
  }

  /** Builds a "field already exists" message naming the field(s) that tripped a unique index. */
  private duplicateKeyMessage(error: MongoServerError): string {
    const fields = Object.keys((error.keyValue as Record<string, unknown>) ?? {});
    if (fields.length === 0) return 'A ULB with these details already exists.';
    return `A ULB with this ${fields.join(', ')} already exists.`;
  }

  async create(dto: CreateUlbDto): Promise<Ulb> {
    const fields = await this.loadFields();
    const { isValid, errors, sanitizedPayload } = this.dynamicFormValidation.validateFinalSubmitAndBuildPayload(
      fields,
      dto.data,
    );
    if (!isValid) this.throwValidationError(errors);

    const patch = this.toMongoPatch(sanitizedPayload);
    const name = String(patch.name);
    patch.slug = this.buildSlug(name);

    try {
      const created = await this.ulbModel.create(patch);
      return created.toObject();
    } catch (error: unknown) {
      if (error instanceof MongoServerError && error.code === 11000) {
        this.logger.warn(`Duplicate ULB detected: ${JSON.stringify(error.keyValue)}`);
        throw new BadRequestException(this.duplicateKeyMessage(error));
      }
      this.logger.error('Failed to create ULB', error);
      throw new BadRequestException('Failed to create ULB');
    }
  }

  async findAll(query: QueryUlbDto): Promise<{
    data: Ulb[];
    page: number;
    limit: number;
    total: number;
    pages: number;
  }> {
    const page = query.page ?? 1;
    const limit = Math.min(query.limit ?? 10, 100);
    const skip = (page - 1) * limit;

    const filter: FilterQuery<UlbDocument> = {};
    if (query.isActive !== undefined) filter.isActive = query.isActive;
    if (query.state) filter.state = new Types.ObjectId(query.state);
    if (query.ulbType) filter.ulbType = new Types.ObjectId(query.ulbType);

    const search = query.search?.trim();
    if (search) {
      const escaped = search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      filter.$or = [{ name: { $regex: escaped, $options: 'i' } }, { code: { $regex: escaped, $options: 'i' } }];
    }

    const sortBy = query.sortBy ?? 'name';
    const sortDir = query.sortDir ?? 1;

    const [data, total] = await Promise.all([
      this.ulbModel
        .find(filter)
        .sort({ [sortBy]: sortDir })
        .skip(skip)
        .limit(limit)
        .lean<Ulb[]>(),
      this.ulbModel.countDocuments(filter),
    ]);

    return { data, page, limit, total, pages: Math.ceil(total / limit) };
  }

  async findOne(id: string): Promise<Ulb> {
    if (!Types.ObjectId.isValid(id)) throw new BadRequestException('Invalid ULB id');
    const ulb = await this.ulbModel.findById(id).lean<Ulb>();
    if (!ulb) throw new NotFoundException('ULB not found');
    return ulb;
  }

  async update(id: string, dto: UpdateUlbDto): Promise<Ulb> {
    if (!Types.ObjectId.isValid(id)) throw new BadRequestException('Invalid ULB id');

    const existing = await this.ulbModel.findById(id).lean<UlbDocument>();
    if (!existing) throw new NotFoundException('ULB not found');

    const fields = await this.loadFields();
    const { isValid, errors, sanitizedPayload } = this.dynamicFormValidation.validateDraftAndBuildPayload(
      fields,
      dto.data,
    );
    if (!isValid) this.throwValidationError(errors);

    const patch = this.toMongoPatch(sanitizedPayload);
    if (Object.keys(patch).length === 0) throw new BadRequestException('No fields provided to update.');
    if (typeof patch.name === 'string') patch.slug = this.buildSlug(patch.name);

    try {
      const updated = await this.ulbModel
        .findByIdAndUpdate(id, { $set: patch }, { new: true, runValidators: true })
        .lean<Ulb>();
      if (!updated) throw new NotFoundException('ULB not found');
      return updated;
    } catch (error: unknown) {
      if (error instanceof MongoServerError && error.code === 11000) {
        throw new BadRequestException(this.duplicateKeyMessage(error));
      }
      throw error;
    }
  }

  async remove(id: string): Promise<{ message: string }> {
    if (!Types.ObjectId.isValid(id)) throw new BadRequestException('Invalid ULB id');
    const deactivated = await this.ulbModel.findByIdAndUpdate(id, { $set: { isActive: false } }).lean();
    if (!deactivated) throw new NotFoundException('ULB not found');
    return { message: 'ULB deactivated successfully' };
  }
}
