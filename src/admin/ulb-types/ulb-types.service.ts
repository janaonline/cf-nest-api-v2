import { ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { MongoServerError } from 'mongodb';
import { Model } from 'mongoose';
import { PaginatedResult } from 'src/common/dto/pagination.dto';
import { UlbEligibilityService } from 'src/module/ulb-eligibility/ulb-eligibility.service';
import { UlbType, UlbTypeDocument } from 'src/schemas/ulb-type.schema';
import { CreateUlbTypeDto } from './dto/create-ulb-type.dto';
import { UpdateUlbTypeDto } from './dto/update-ulb-type.dto';

/**
 * ADMIN-only CRUD for the `ulbtypes` reference-data collection — in particular
 * `ineligibleForGrantCycles`, which previously had no application-level way to edit at all (a raw
 * `mongosh` command was the only option). Every mutating method calls
 * `UlbEligibilityService.invalidate()` for every grant cycle touched by the write, since that
 * service's cache is purely event-driven (no TTL) — this CRUD is the only thing that ever clears it.
 */
@Injectable()
export class UlbTypesService {
  private readonly logger = new Logger(UlbTypesService.name);

  constructor(
    @InjectModel(UlbType.name) private readonly ulbTypeModel: Model<UlbTypeDocument>,
    private readonly ulbEligibilityService: UlbEligibilityService,
  ) {}

  async create(dto: CreateUlbTypeDto): Promise<UlbTypeDocument> {
    const isActive = dto.isActive ?? true;
    await this.assertNoConflict(dto.name, isActive);

    try {
      const created = await this.ulbTypeModel.create({ ...dto, isActive });
      this.logger.log(`ULB type created: ${created.name}`);
      await this.invalidateCycles(created.ineligibleForGrantCycles ?? []);
      return created;
    } catch (error: unknown) {
      if (error instanceof MongoServerError && error.code === 11000) {
        throw new ConflictException(
          `A${isActive ? 'n active' : 'n inactive'} ULB type named "${dto.name}" already exists`,
        );
      }
      throw error;
    }
  }

  async findAll(page = 1, limit = 20): Promise<PaginatedResult<UlbTypeDocument>> {
    const skip = (page - 1) * limit;
    const [data, total] = await Promise.all([
      this.ulbTypeModel.find().sort({ name: 1 }).skip(skip).limit(limit).exec(),
      this.ulbTypeModel.countDocuments(),
    ]);
    return { data, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  async findOne(id: string): Promise<UlbTypeDocument> {
    const doc = await this.ulbTypeModel.findById(id).exec();
    if (!doc) throw new NotFoundException('ULB type not found');
    return doc;
  }

  async update(id: string, dto: UpdateUlbTypeDto): Promise<UlbTypeDocument> {
    const existing = await this.ulbTypeModel.findById(id).exec();
    if (!existing) throw new NotFoundException('ULB type not found');

    const nextName = dto.name ?? existing.name;
    const nextIsActive = dto.isActive ?? existing.isActive;
    if (dto.name !== undefined || dto.isActive !== undefined) {
      await this.assertNoConflict(nextName, nextIsActive, id);
    }

    const cyclesBefore = existing.ineligibleForGrantCycles ?? [];
    Object.assign(existing, dto);

    try {
      await existing.save();
    } catch (error: unknown) {
      if (error instanceof MongoServerError && error.code === 11000) {
        throw new ConflictException(
          `A${nextIsActive ? 'n active' : 'n inactive'} ULB type named "${nextName}" already exists`,
        );
      }
      throw error;
    }

    this.logger.log(`ULB type updated: ${existing.name}`);
    // Union of before/after so removing a cycle busts its cache too, not only adding one.
    await this.invalidateCycles([...cyclesBefore, ...(existing.ineligibleForGrantCycles ?? [])]);
    return existing;
  }

  async remove(id: string): Promise<{ message: string }> {
    const existing = await this.ulbTypeModel.findById(id).exec();
    if (!existing) throw new NotFoundException('ULB type not found');

    existing.isActive = false;
    await existing.save();
    this.logger.log(`ULB type deactivated: ${existing.name}`);
    await this.invalidateCycles(existing.ineligibleForGrantCycles ?? []);
    return { message: `ULB type "${existing.name}" deactivated` };
  }

  private async assertNoConflict(name: string, isActive: boolean, excludeId?: string): Promise<void> {
    const conflict = await this.ulbTypeModel
      .findOne({ name, isActive, ...(excludeId ? { _id: { $ne: excludeId } } : {}) })
      .exec();
    if (conflict) {
      throw new ConflictException(`A${isActive ? 'n active' : 'n inactive'} ULB type named "${name}" already exists`);
    }
  }

  private async invalidateCycles(cycles: string[]): Promise<void> {
    const unique = [...new Set(cycles)];
    await Promise.all(unique.map((cycle) => this.ulbEligibilityService.invalidate(cycle)));
  }
}
