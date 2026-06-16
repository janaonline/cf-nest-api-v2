import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { FilterQuery, Model, Types } from 'mongoose';
import { FormJson, FormJsonDocument } from './schemas/form-json.schema';
import type { IFormJson } from './interfaces/form-json.interface';
import type { CreateFormJsonDto } from './dto/create-form-json.dto';
import type { UpdateFormJsonDto } from './dto/update-form-json.dto';
import type { QueryFormJsonDto } from './dto/query-form-json.dto';

@Injectable()
export class FormJsonService {
  constructor(
    @InjectModel(FormJson.name)
    private readonly model: Model<FormJsonDocument>,
  ) {}

  /** Returns all documents matching the provided filters. O(n). */
  findAll(query: QueryFormJsonDto): Promise<IFormJson[]> {
    const filter: FilterQuery<FormJsonDocument> = {};
    if (query.type !== undefined) filter['type'] = query.type;
    if (query.design_year !== undefined) filter['design_year'] = new Types.ObjectId(query.design_year);
    if (query.isActive !== undefined) filter['isActive'] = query.isActive;
    return this.model.find(filter).lean().exec() as unknown as Promise<IFormJson[]>;
  }

  /** Fetches one document by _id; throws 404 when absent. O(1). */
  async findById(id: string): Promise<IFormJson> {
    const doc = (await this.model.findById(id).lean().exec()) as unknown as IFormJson | null;
    if (!doc) throw new NotFoundException(`FormJson ${id} not found`);
    return doc;
  }

  /** Fetches the active document matching type; hits the {type, isActive} compound index. O(1). */
  async findByType(type: string): Promise<IFormJson> {
    const doc = (await this.model.findOne({ type, isActive: true }).lean().exec()) as unknown as IFormJson | null;
    if (!doc) throw new NotFoundException(`FormJson of type "${type}" not found`);
    return doc;
  }

  /** Creates a new FormJson; unique (design_year + formId) enforcement is delegated to MongoDB. O(1). */
  async create(dto: CreateFormJsonDto): Promise<IFormJson> {
    const created = await this.model.create({
      design_year: new Types.ObjectId(dto.design_year),
      formId: dto.formId,
      type: dto.type,
      data: dto.data ?? [],
      meta: dto.meta,
      isActive: dto.isActive ?? true,
    });
    return created.toObject() as unknown as IFormJson;
  }

  /** Applies a sparse $set update; only provided fields are written. Throws 404 when absent. O(1). */
  async update(id: string, dto: UpdateFormJsonDto): Promise<IFormJson> {
    const patch: Record<string, unknown> = {};
    if (dto.design_year !== undefined) patch['design_year'] = new Types.ObjectId(dto.design_year);
    if (dto.formId !== undefined) patch['formId'] = dto.formId;
    if (dto.type !== undefined) patch['type'] = dto.type;
    if (dto.data !== undefined) patch['data'] = dto.data;
    if (dto.meta !== undefined) patch['meta'] = dto.meta;
    if (dto.isActive !== undefined) patch['isActive'] = dto.isActive;

    const updated = (await this.model
      .findByIdAndUpdate(id, { $set: patch }, { new: true })
      .lean()
      .exec()) as unknown as IFormJson | null;
    if (!updated) throw new NotFoundException(`FormJson ${id} not found`);
    return updated;
  }

  /** Sets isActive=false without deleting the document. Throws 404 when absent. O(1). */
  async remove(id: string): Promise<void> {
    const result = await this.model
      .findByIdAndUpdate(id, { $set: { isActive: false } })
      .lean()
      .exec();
    if (!result) throw new NotFoundException(`FormJson ${id} not found`);
  }
}
