import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { MongoServerError } from 'mongodb';
import { FilterQuery, Model, Types } from 'mongoose';
import type { IAuthUser } from 'src/common/interfaces/auth-user.interface';
import { Role } from 'src/module/auth/enum/role.enum';
import { DynamicFormValidationService } from 'src/module/xvi-fc/common/dynamic-form-validation/dynamic-form-validation.service';
import type { XviFcValidationErrorMap } from 'src/module/xvi-fc/common/response/xvi-fc-api-response';
import type { FieldConfig, ResolvedSection } from 'src/module/xvi-fc/common/types/field-config.type';
import { FormJsonService } from 'src/form-json/form-json.service';
import { State, StateDocument } from 'src/schemas/state.schema';
import { Ulb, UlbDocument } from 'src/schemas/ulb.schema';
import {
  DEFAULT_ULB_EDIT_SECTIONS,
  DEFAULT_ULB_FIELDS,
  DEFAULT_ULB_REGISTER_SECTIONS,
  RegisterUlbSectionLayout,
  ULB_EDIT_SECTIONS_FORM_JSON_TYPE,
  ULB_FORM_JSON_TYPE,
  ULB_REGISTER_SECTIONS_FORM_JSON_TYPE,
} from './constants/ulb-form.constants';
import { CreateUlbDto } from './dto/create-ulb.dto';
import { QueryUlbDto } from './dto/query-ulb.dto';
import { RejectUlbDto } from './dto/reject-ulb.dto';
import { UpdateUlbDto } from './dto/update-ulb.dto';

const OBJECT_ID_FIELDS = new Set(['state', 'ulbType', 'UA']);

@Injectable()
export class UlbService {
  private readonly logger = new Logger(UlbService.name);

  constructor(
    @InjectModel(Ulb.name) private readonly ulbModel: Model<UlbDocument>,
    @InjectModel(State.name) private readonly stateModel: Model<StateDocument>,
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

  /** Loads the admin-configurable section/grid skeleton for the Register ULB page, falling back to built-in defaults. */
  private async loadRegisterSectionsLayout(): Promise<RegisterUlbSectionLayout[]> {
    try {
      const formJson = await this.formJsonService.findByType(ULB_REGISTER_SECTIONS_FORM_JSON_TYPE);
      return formJson.data?.length
        ? (formJson.data as unknown as RegisterUlbSectionLayout[])
        : DEFAULT_ULB_REGISTER_SECTIONS;
    } catch {
      return DEFAULT_ULB_REGISTER_SECTIONS;
    }
  }

  /** Loads the admin-configurable section/grid skeleton for the Edit ULB dialog, falling back to built-in defaults. */
  private async loadEditSectionsLayout(): Promise<RegisterUlbSectionLayout[]> {
    try {
      const formJson = await this.formJsonService.findByType(ULB_EDIT_SECTIONS_FORM_JSON_TYPE);
      return formJson.data?.length
        ? (formJson.data as unknown as RegisterUlbSectionLayout[])
        : DEFAULT_ULB_EDIT_SECTIONS;
    } catch {
      return DEFAULT_ULB_EDIT_SECTIONS;
    }
  }

  /**
   * Real field definitions keyed by `key`, with `ulbType` and `state` replaced by live selects
   * (options populated from the ulbtypes/states collections). Shared by both the Register and
   * Edit section endpoints — which fields actually surface depends on which layout is merged in.
   */
  private async buildResolvedFieldsByKey(): Promise<Map<string, FieldConfig>> {
    const [fields, ulbTypes, states] = await Promise.all([this.loadFields(), this.findTypes(), this.findStates()]);

    const fieldsByKey = new Map(fields.map((field) => [field.key, field]));
    fieldsByKey.set('ulbType', {
      key: 'ulbType',
      label: 'ULB Type',
      formFieldType: 'select',
      required: true,
      placeholder: 'Select type...',
      options: ulbTypes.map((type) => ({ id: String(type._id), label: type.name })),
      validations: [{ name: 'required', validator: null, message: 'ULB type is required.' }],
    });
    fieldsByKey.set('state', {
      key: 'state',
      label: 'State',
      formFieldType: 'select',
      required: true,
      placeholder: 'Select a state...',
      options: states.map((state) => ({ id: String(state._id), label: state.name })),
      validations: [{ name: 'required', validator: null, message: 'State is required.' }],
    });

    return fieldsByKey;
  }

  /** Merges a section/grid layout skeleton with resolved field definitions, dropping (and logging)
   *  any layout entry whose key has no matching field — keeps a bad admin edit from breaking the page. */
  private mergeLayoutWithFields(
    layout: RegisterUlbSectionLayout[],
    fieldsByKey: Map<string, FieldConfig>,
  ): ResolvedSection[] {
    return layout.map((section) => ({
      title: section.title,
      icon: section.icon,
      fields: section.fields
        .map((fieldLayout) => {
          const field = fieldsByKey.get(fieldLayout.key);
          if (!field) {
            this.logger.warn(`ULB section layout references unknown field key "${fieldLayout.key}"`);
            return null;
          }
          return { ...field, grid: fieldLayout.grid, labelHint: fieldLayout.labelHint, hintText: fieldLayout.hintText };
        })
        .filter((field): field is NonNullable<typeof field> => field !== null),
    }));
  }

  /**
   * Fully resolved section/field config for the Register ULB page: merges the section layout
   * (grid width, hints) with each field's real definition (label, formFieldType, validations, ...)
   * from ULB_MASTER, plus a live `ulbType` select populated from the ulbtypes collection. The
   * frontend renders this response directly — no client-side lookup or merging required.
   */
  async getRegisterSections(): Promise<ResolvedSection[]> {
    const [fieldsByKey, layout] = await Promise.all([this.buildResolvedFieldsByKey(), this.loadRegisterSectionsLayout()]);
    return this.mergeLayoutWithFields(layout, fieldsByKey);
  }

  /**
   * Fully resolved section/field config for the ADMIN-only Edit ULB dialog — same merge as
   * `getRegisterSections()`, but against the edit layout, which covers every ULB field (including
   * `code` and a live `state` select) rather than just the Register page's subset.
   */
  async getEditSections(): Promise<ResolvedSection[]> {
    const [fieldsByKey, layout] = await Promise.all([this.buildResolvedFieldsByKey(), this.loadEditSectionsLayout()]);
    return this.mergeLayoutWithFields(layout, fieldsByKey);
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

  /** Generates a `<STATE_CODE><sequence>` ULB code (e.g. "AP004"), retrying past any collisions. */
  private async generateUlbCode(stateId: string): Promise<string> {
    const state = await this.stateModel.findById(stateId).lean<{ code?: string }>();
    const prefix = (state?.code || 'ULB').toUpperCase();
    const existingCount = await this.ulbModel.countDocuments({ state: new Types.ObjectId(stateId) });

    for (let attempt = 0; attempt < 5; attempt++) {
      const candidate = `${prefix}${String(existingCount + 1 + attempt).padStart(3, '0')}`;
      const exists = await this.ulbModel.exists({ code: candidate });
      if (!exists) return candidate;
    }

    return `${prefix}${Date.now()}`;
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

  /**
   * Fills in a default `approval` block for documents created before this field existed.
   * `.lean()` reads bypass Mongoose's schema-default application, so legacy ULBs come back
   * with `approval: undefined` — treat them as pre-approved master data.
   */
  private withApprovalDefaults<T extends Ulb>(ulb: T): T {
    if (ulb.approval) return ulb;
    return {
      ...ulb,
      approval: { status: 'APPROVED', submittedBy: null, reviewedBy: null, reviewedAt: null, rejectReason: '' },
    };
  }

  async create(dto: CreateUlbDto, user: IAuthUser): Promise<Ulb> {
    const fields = await this.loadFields();
    const data = { ...dto.data };

    // The simplified Register-ULB page doesn't collect a code — generate one from the
    // submitted state so `code` still satisfies the required field-config validation below.
    if (!data.code && typeof data.state === 'string' && Types.ObjectId.isValid(data.state)) {
      data.code = await this.generateUlbCode(data.state);
    }

    const { isValid, errors, sanitizedPayload } = this.dynamicFormValidation.validateFinalSubmitAndBuildPayload(
      fields,
      data,
    );
    if (!isValid) this.throwValidationError(errors);

    const patch = this.toMongoPatch(sanitizedPayload);
    const name = String(patch.name);
    patch.slug = this.buildSlug(name);

    if (user.role === Role.STATE) {
      // A STATE user can only submit ULBs for their own state; the submitted state (if any) is ignored.
      if (!user.state) throw new ForbiddenException('Your account has no state assigned.');
      patch.state = new Types.ObjectId(String(user.state));
      patch.approval = { status: 'PENDING', submittedBy: new Types.ObjectId(user._id) };
    } else {
      // ADMIN (or other privileged callers) create pre-approved master records.
      patch.approval = { status: 'APPROVED', reviewedBy: new Types.ObjectId(user._id), reviewedAt: new Date() };
    }

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

  async findAll(
    query: QueryUlbDto,
    user: IAuthUser,
  ): Promise<{
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
    if (query.approvalStatus) filter['approval.status'] = query.approvalStatus;
    if (query.ulbType) filter.ulbType = new Types.ObjectId(query.ulbType);

    if (user.role === Role.STATE) {
      // STATE users only ever see ULBs (of any approval status) that belong to their own state.
      if (!user.state) throw new ForbiddenException('Your account has no state assigned.');
      filter.state = new Types.ObjectId(String(user.state));
    } else if (query.state) {
      filter.state = new Types.ObjectId(query.state);
    }

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

    return {
      data: data.map((ulb) => this.withApprovalDefaults(ulb)),
      page,
      limit,
      total,
      pages: Math.ceil(total / limit),
    };
  }

  async findOne(id: string): Promise<Ulb> {
    if (!Types.ObjectId.isValid(id)) throw new BadRequestException('Invalid ULB id');
    const ulb = await this.ulbModel.findById(id).lean<Ulb>();
    if (!ulb) throw new NotFoundException('ULB not found');
    return this.withApprovalDefaults(ulb);
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
      return this.withApprovalDefaults(updated);
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

  /** Approves a PENDING ULB submission (ADMIN only — enforced by RolesGuard at the controller). */
  async approve(id: string, user: IAuthUser): Promise<Ulb> {
    if (!Types.ObjectId.isValid(id)) throw new BadRequestException('Invalid ULB id');

    const updated = await this.ulbModel
      .findByIdAndUpdate(
        id,
        {
          $set: {
            'approval.status': 'APPROVED',
            'approval.reviewedBy': new Types.ObjectId(user._id),
            'approval.reviewedAt': new Date(),
            'approval.rejectReason': '',
          },
        },
        { new: true },
      )
      .lean<Ulb>();
    if (!updated) throw new NotFoundException('ULB not found');
    return updated;
  }

  /** Rejects a PENDING ULB submission (ADMIN only — enforced by RolesGuard at the controller). */
  async reject(id: string, dto: RejectUlbDto, user: IAuthUser): Promise<Ulb> {
    if (!Types.ObjectId.isValid(id)) throw new BadRequestException('Invalid ULB id');

    const updated = await this.ulbModel
      .findByIdAndUpdate(
        id,
        {
          $set: {
            'approval.status': 'REJECTED',
            'approval.reviewedBy': new Types.ObjectId(user._id),
            'approval.reviewedAt': new Date(),
            'approval.rejectReason': dto.reason,
          },
        },
        { new: true },
      )
      .lean<Ulb>();
    if (!updated) throw new NotFoundException('ULB not found');
    return updated;
  }

  /**
   * Lists ULB types for populating a select. `ulbtypes` has no Mongoose model in this codebase
   * (see UsersService.getProfileContacts) — queried directly via the raw collection.
   */
  async findTypes(): Promise<{ _id: Types.ObjectId; name: string }[]> {
    return this.ulbModel.db
      .collection('ulbtypes')
      .find({}, { projection: { name: 1 } })
      .sort({ name: 1 })
      .toArray() as unknown as Promise<{ _id: Types.ObjectId; name: string }[]>;
  }

  /** Lists active states for populating a select (e.g. the Edit dialog's live `state` field). */
  private async findStates(): Promise<{ _id: Types.ObjectId; name: string }[]> {
    return this.stateModel
      .find({ isActive: true }, { name: 1 })
      .sort({ name: 1 })
      .lean<{ _id: Types.ObjectId; name: string }[]>();
  }
}
