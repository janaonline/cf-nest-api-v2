import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import * as bcrypt from 'bcrypt';
import { randomBytes } from 'crypto';
import { MongoServerError } from 'mongodb';
import { FilterQuery, Model, Types } from 'mongoose';
import type { IAuthUser } from 'src/common/interfaces/auth-user.interface';
import { FileTokenService } from 'src/core/file-token/file-token.service';
import { EmailQueueService } from 'src/core/queue/email-queue/email-queue.service';
import { Role } from 'src/module/auth/enum/role.enum';
import { DynamicFormValidationService } from 'src/module/xvi-fc/common/dynamic-form-validation/dynamic-form-validation.service';
import type { XviFcValidationErrorMap } from 'src/module/xvi-fc/common/response/xvi-fc-api-response';
import type { FieldConfig, SectionLayout } from 'src/module/xvi-fc/common/types/field-config.type';
import { FormJsonService } from 'src/form-json/form-json.service';
import type { CommonFile } from 'src/schemas/common/file.schema';
import { State, StateDocument } from 'src/schemas/state.schema';
import { Ulb, UlbDocument } from 'src/schemas/ulb.schema';
import { User, UserDocument } from 'src/schemas/user/user.schema';
import {
  DEFAULT_ULB_EDIT_SECTIONS,
  DEFAULT_ULB_FIELDS,
  DEFAULT_ULB_REGISTER_SECTIONS,
  // RegisterUlbSectionLayout,
  ULB_EDIT_SECTIONS_FORM_JSON_TYPE,
  ULB_FORM_JSON_TYPE,
  ULB_PRIMARY_CONTACT_FIELD_KEYS,
  ULB_REGISTER_SECTIONS_FORM_JSON_TYPE,
} from './constants/ulb-form.constants';
import { CreateUlbDto } from './dto/create-ulb.dto';
import { QueryUlbDto } from './dto/query-ulb.dto';
import { RejectUlbDto } from './dto/reject-ulb.dto';
import { UpdateUlbDto } from './dto/update-ulb.dto';

const OBJECT_ID_FIELDS = new Set(['state', 'ulbType', 'UA']);
const TEMP_PASSWORD_TTL_MS = 72 * 60 * 60 * 1000;

@Injectable()
export class UlbService {
  private readonly logger = new Logger(UlbService.name);

  constructor(
    @InjectModel(Ulb.name) private readonly ulbModel: Model<UlbDocument>,
    @InjectModel(State.name) private readonly stateModel: Model<StateDocument>,
    @InjectModel(User.name) private readonly userModel: Model<UserDocument>,
    private readonly formJsonService: FormJsonService,
    private readonly dynamicFormValidation: DynamicFormValidationService,
    private readonly emailQueueService: EmailQueueService,
    private readonly configService: ConfigService,
    private readonly fileTokenService: FileTokenService,
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
  private async loadRegisterSectionsLayout(): Promise<SectionLayout[]> {
    try {
      const formJson = await this.formJsonService.findByType(ULB_REGISTER_SECTIONS_FORM_JSON_TYPE);
      return formJson.data?.length ? (formJson.data as unknown as SectionLayout[]) : DEFAULT_ULB_REGISTER_SECTIONS;
    } catch {
      return DEFAULT_ULB_REGISTER_SECTIONS;
    }
  }

  /** Loads the admin-configurable section/grid skeleton for the Edit ULB dialog, falling back to built-in defaults. */
  private async loadEditSectionsLayout(): Promise<SectionLayout[]> {
    try {
      const formJson = await this.formJsonService.findByType(ULB_EDIT_SECTIONS_FORM_JSON_TYPE);
      return formJson.data?.length ? (formJson.data as unknown as SectionLayout[]) : DEFAULT_ULB_EDIT_SECTIONS;
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
    const [fields, ulbTypes] = await Promise.all([
      this.loadFields(),
      this.findTypes(),
      //  this.findStates()
    ]);
    const fieldsByKey = new Map(fields.map((field) => [field.key, field]));

    const ulbTypeField = fieldsByKey.get('ulbType');
    if (ulbTypeField) {
      ulbTypeField.options = ulbTypes.map((type) => ({ id: String(type._id), label: type.name }));
    }

    return fieldsByKey;
  }

  /** Merges a section/grid layout skeleton with resolved field definitions, dropping (and logging)
   *  any layout entry whose key has no matching field — keeps a bad admin edit from breaking the page. */
  private mergeLayoutWithFields(layout: SectionLayout[], fieldsByKey: Map<string, FieldConfig>): SectionLayout[] {
    return layout.map((section) => ({
      title: section.title,
      icon: section.icon,
      subtitle: section.subtitle,
      fields: section.fields
        .map((fieldLayout) => {
          const field = fieldsByKey.get(fieldLayout.key);
          if (!field) {
            this.logger.warn(`ULB section layout references unknown field key "${fieldLayout.key}"`);
            return null;
          }
          return {
            ...field,
            grid: fieldLayout.grid,
            labelHint: fieldLayout.labelHint ?? field.labelHint,
            hintText: fieldLayout.hintText ?? field.hintText,
          };
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
  async getRegisterSections(): Promise<SectionLayout[]> {
    const [fieldsByKey, layout] = await Promise.all([
      this.buildResolvedFieldsByKey(),
      this.loadRegisterSectionsLayout(),
    ]);
    return this.mergeLayoutWithFields(layout, fieldsByKey);
  }

  /**
   * Fully resolved section/field config for the ADMIN-only Edit ULB dialog — same merge as
   * `getRegisterSections()`, but against the edit layout, which covers every ULB field (including
   * `code` and a live `state` select) rather than just the Register page's subset.
   */
  async getEditSections(): Promise<SectionLayout[]> {
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

  /**
   * Normalizes `gazetteNotificationFile` for API responses and signs it into an openable URL.
   * Documents created before the CommonFile migration (see a2ed410) store
   * `{ fileName, fileUrl, fileSize, mimeType, noOfPage }`; the current schema stores
   * `{ originalName, path, sizeKb, extension, pageCount }`. Both are read here so old and new
   * records render the same way; the raw storage path alone isn't a URL a browser can open.
   */
  private withSignedGazetteFile<T extends Ulb>(ulb: T): T {
    const file = ulb.gazetteNotificationFile as
      | (CommonFile & { fileName?: string; fileUrl?: string; fileSize?: number | null; noOfPage?: number | null })
      | null;
    const rawPath = file?.fileUrl || file?.path;
    if (!file || !rawPath) return ulb;

    return {
      ...ulb,
      gazetteNotificationFile: {
        fileName: file.fileName ?? file.originalName ?? '',
        fileUrl: this.fileTokenService.signFileUrl(rawPath),
        fileSize: file.fileSize ?? (typeof file.sizeKb === 'number' ? Math.round(file.sizeKb * 1024) : null),
        mimeType: file.mimeType,
        noOfPage: file.noOfPage ?? file.pageCount ?? null,
      },
    } as T;
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

    const primaryContact = this.extractPrimaryContact(sanitizedPayload);
    if (primaryContact.email) await this.ensureContactNotRegistered(primaryContact.email, primaryContact.mobile);

    const patch = this.toMongoPatch(sanitizedPayload);
    const name = String(patch.name);
    await this.ensureNameNotTaken(name);
    patch.slug = this.buildSlug(name);
    if (typeof patch.censusCode === 'string' && patch.censusCode.trim()) {
      await this.ensureCensusCodeNotTaken(patch.censusCode);
    }

    let stateId: Types.ObjectId;
    if (user.role === Role.STATE) {
      // A STATE user can only submit ULBs for their own state; the submitted state (if any) is ignored.
      if (!user.state) throw new ForbiddenException('Your account has no state assigned.');
      stateId = new Types.ObjectId(String(user.state));
      patch.state = stateId;
      patch.approval = { status: 'PENDING', submittedBy: new Types.ObjectId(user._id) };
    } else {
      // ADMIN (or other privileged callers) create pre-approved master records.
      stateId = patch.state as Types.ObjectId;
      patch.approval = { status: 'APPROVED', reviewedBy: new Types.ObjectId(user._id), reviewedAt: new Date() };
    }

    const created = await this.persistUlb(patch);

    if (primaryContact.email) {
      await this.createPrimaryContactUser(primaryContact, created._id, stateId, name, user);
    }

    return created.toObject();
  }

  /**
   * Case-insensitive uniqueness guard for ULB name, checked ahead of the write so callers get a
   * clean 400 instead of relying solely on the schema's unique index (which is exact-match and
   * whose duplicate-key error only surfaces after the write is attempted).
   */
  private async ensureNameNotTaken(name: string, excludeId?: string): Promise<void> {
    const escaped = name.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const filter: FilterQuery<UlbDocument> = { name: { $regex: `^${escaped}$`, $options: 'i' } };
    if (excludeId) filter._id = { $ne: new Types.ObjectId(excludeId) };

    const existing = await this.ulbModel.exists(filter);
    if (existing) throw new BadRequestException('A ULB with this name already exists.');
  }

  /**
   * Uniqueness guard for censusCode, checked ahead of the write so callers get a clean 400
   * instead of relying solely on the schema's unique index (whose duplicate-key error only
   * surfaces after the write is attempted). censusCode is optional — callers must skip this
   * check entirely for an absent/blank value, matching the schema's sparse index which allows
   * any number of documents with no censusCode.
   */
  private async ensureCensusCodeNotTaken(censusCode: string, excludeId?: string): Promise<void> {
    const filter: FilterQuery<UlbDocument> = { censusCode: censusCode.trim() };
    if (excludeId) filter._id = { $ne: new Types.ObjectId(excludeId) };

    const existing = await this.ulbModel.exists(filter);
    if (existing) throw new BadRequestException('A ULB with this census code already exists.');
  }

  private async persistUlb(patch: Record<string, unknown>) {
    try {
      return await this.ulbModel.create(patch);
    } catch (error: unknown) {
      if (error instanceof MongoServerError && error.code === 11000) {
        this.logger.warn(`Duplicate ULB detected: ${JSON.stringify(error.keyValue)}`);
        throw new BadRequestException(this.duplicateKeyMessage(error));
      }
      this.logger.error('Failed to create ULB', error);
      throw new BadRequestException('Failed to create ULB');
    }
  }

  /** Pulls the Register page's primary-contact fields out of the sanitized payload — these
   *  describe the ULB's first login and are never persisted onto the `Ulb` document itself. */
  private extractPrimaryContact(sanitizedPayload: Record<string, unknown>): {
    name?: string;
    designation?: string;
    email?: string;
    mobile?: string;
  } {
    const [nameKey, designationKey, emailKey, mobileKey] = ULB_PRIMARY_CONTACT_FIELD_KEYS;
    const contact = {
      name: sanitizedPayload[nameKey] as string | undefined,
      designation: sanitizedPayload[designationKey] as string | undefined,
      email: sanitizedPayload[emailKey] as string | undefined,
      mobile: sanitizedPayload[mobileKey] as string | undefined,
    };
    for (const key of ULB_PRIMARY_CONTACT_FIELD_KEYS) delete sanitizedPayload[key];
    return contact;
  }

  /** Guards against creating a login for an email/mobile that's already an active account —
   *  checked before the ULB itself is created so we never end up with an orphaned ULB record. */
  private async ensureContactNotRegistered(email: string, mobile?: string): Promise<void> {
    const or: FilterQuery<UserDocument>[] = [{ email }];
    if (mobile) or.push({ mobile });
    const existing = await this.userModel.findOne({ isDeleted: false, $or: or }).select('_id').lean().exec();
    if (existing) {
      throw new BadRequestException('This email or mobile number is already registered to another account.');
    }
  }

  /** Provisions the ULB's first login: a `Role.ULB` account with a temporary password, emailed
   *  to the primary contact — mirrors the STATE/MoHUA member-invite flow in `UsersService`. */
  private async createPrimaryContactUser(
    contact: { name?: string; designation?: string; email?: string; mobile?: string },
    ulbId: Types.ObjectId,
    stateId: Types.ObjectId,
    ulbName: string,
    requester: IAuthUser,
  ): Promise<void> {
    const tempPassword = this.generateTempPassword();
    const hashedPassword = await bcrypt.hash(tempPassword, 12);

    await this.userModel.create({
      name: contact.name,
      email: contact.email,
      mobile: contact.mobile || undefined,
      designation: contact.designation || '',
      role: Role.ULB,
      ulb: ulbId,
      state: stateId,
      createdBy: new Types.ObjectId(requester._id),
      status: 'APPROVED',
      isActive: true,
      isEmailVerified: true,
      isDeleted: false,
      password: hashedPassword,
      isNewUser: true,
      tempPasswordExpiresAt: new Date(Date.now() + TEMP_PASSWORD_TTL_MS),
    });

    const loginUrl = `${this.configService.get<string>('CLIENT_URL', 'https://cityfinance.in')}/login`;
    this.emailQueueService
      .addEmailJob({
        to: contact.email as string,
        subject: 'You have been invited to the CityFinance Portal',
        templateName: './ulb-member-invite',
        mailData: {
          name: contact.name,
          email: contact.email,
          mobile: contact.mobile ?? '',
          ulbName,
          loginUrl,
          tempPassword,
        },
      })
      .catch((err: unknown) => {
        this.logger.error(`Failed to queue ULB primary contact invite email to ${contact.email}:`, err);
      });
  }

  /** Generates a random temporary password for a newly-provisioned login (mirrors `UsersService`). */
  private generateTempPassword(): string {
    const upper = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
    const lower = 'abcdefghjkmnpqrstuvwxyz';
    const digits = '23456789';
    const symbols = '@#$%^&*!';
    const all = upper + lower + digits + symbols;
    const pick = (set: string) => set[randomBytes(1)[0] % set.length];
    const chars = [
      pick(upper),
      pick(upper),
      pick(lower),
      pick(lower),
      pick(digits),
      pick(digits),
      pick(symbols),
      ...Array.from({ length: 5 }, () => pick(all)),
    ];
    for (let i = chars.length - 1; i > 0; i--) {
      const j = randomBytes(1)[0] % (i + 1);
      [chars[i], chars[j]] = [chars[j], chars[i]];
    }
    return chars.join('');
  }

  async findAll(
    query: QueryUlbDto,
    user: IAuthUser,
  ): Promise<{
    data: (Ulb & { stateName: string; ulbTypeName: string })[];
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
      data: await this.attachLookupNames(data.map((ulb) => this.withSignedGazetteFile(this.withApprovalDefaults(ulb)))),
      page,
      limit,
      total,
      pages: Math.ceil(total / limit),
    };
  }

  /** Resolves `state`/`ulbType` ids on a page of ULBs to their display names, so the list page
   *  can render them directly without a separate client-side lookup call. */
  private async attachLookupNames<T extends Ulb>(
    ulbs: T[],
  ): Promise<(T & { stateName: string; ulbTypeName: string })[]> {
    if (ulbs.length === 0) return [];

    const stateIds = [...new Set(ulbs.map((ulb) => String(ulb.state)).filter(Boolean))];
    const ulbTypeIds = [...new Set(ulbs.map((ulb) => String(ulb.ulbType)).filter(Boolean))];

    type LookupDoc = { _id: Types.ObjectId; name: string };

    const [states, ulbTypes] = await Promise.all([
      stateIds.length
        ? this.stateModel
            .find({ _id: { $in: stateIds.map((id) => new Types.ObjectId(id)) } }, { name: 1 })
            .lean<LookupDoc[]>()
        : Promise.resolve<LookupDoc[]>([]),
      ulbTypeIds.length
        ? (this.ulbModel.db
            .collection('ulbtypes')
            .find({ _id: { $in: ulbTypeIds.map((id) => new Types.ObjectId(id)) } }, { projection: { name: 1 } })
            .toArray() as unknown as Promise<LookupDoc[]>)
        : Promise.resolve<LookupDoc[]>([]),
    ]);

    const stateNameById = new Map(states.map((s) => [String(s._id), s.name]));
    const ulbTypeNameById = new Map(ulbTypes.map((t) => [String(t._id), t.name]));

    return ulbs.map((ulb) => ({
      ...ulb,
      stateName: stateNameById.get(String(ulb.state)) ?? '',
      ulbTypeName: ulbTypeNameById.get(String(ulb.ulbType)) ?? '',
    }));
  }

  async findOne(id: string): Promise<Ulb> {
    if (!Types.ObjectId.isValid(id)) throw new BadRequestException('Invalid ULB id');
    const ulb = await this.ulbModel.findById(id).lean<Ulb>();
    if (!ulb) throw new NotFoundException('ULB not found');
    return this.withSignedGazetteFile(this.withApprovalDefaults(ulb));
  }

  /**
   * Updates a ULB. ADMIN may edit any ULB at any time. A STATE user may only edit their own
   * state's ULB, and only while it's REJECTED — this is the "fix and resubmit" path for a
   * submission an ADMIN sent back, not a general edit capability. A STATE resubmission always
   * resets `approval` back to PENDING so the ADMIN reviews the corrected data.
   */
  async update(id: string, dto: UpdateUlbDto, user: IAuthUser): Promise<Ulb> {
    if (!Types.ObjectId.isValid(id)) throw new BadRequestException('Invalid ULB id');

    const existing = await this.ulbModel.findById(id).lean<UlbDocument>();
    if (!existing) throw new NotFoundException('ULB not found');

    if (user.role === Role.STATE) {
      if (!user.state || String(existing.state) !== String(user.state)) {
        throw new ForbiddenException('You can only edit ULBs in your own state.');
      }
      if (existing.approval?.status !== 'REJECTED') {
        throw new ForbiddenException('You can only edit a rejected ULB submission.');
      }
    }

    const fields = await this.loadFields();
    const { isValid, errors, sanitizedPayload } = this.dynamicFormValidation.validateDraftAndBuildPayload(
      fields,
      dto.data,
    );
    if (!isValid) this.throwValidationError(errors);

    // Primary-contact fields only make sense at registration time (they provision the ULB's
    // first login) — never persisted onto the Ulb document, so they're irrelevant to an update.
    this.extractPrimaryContact(sanitizedPayload);

    const patch = this.toMongoPatch(sanitizedPayload);
    if (Object.keys(patch).length === 0) throw new BadRequestException('No fields provided to update.');
    if (typeof patch.name === 'string') {
      const nameChanged = patch.name.trim().toLowerCase() !== existing.name?.trim().toLowerCase();
      if (nameChanged) await this.ensureNameNotTaken(patch.name, id);
      patch.slug = this.buildSlug(patch.name);
    }
    if (typeof patch.censusCode === 'string' && patch.censusCode.trim()) {
      const censusCodeChanged = patch.censusCode.trim() !== (existing.censusCode ?? '').trim();
      if (censusCodeChanged) await this.ensureCensusCodeNotTaken(patch.censusCode, id);
    }

    if (user.role === Role.STATE) {
      patch.approval = { status: 'PENDING', submittedBy: new Types.ObjectId(user._id) };
    }

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
