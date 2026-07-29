import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import axios from 'axios';
import { Model, PipelineStage, Types } from 'mongoose';
import { S3Service } from 'src/core/s3/s3.service';
import type { AuthUser } from 'src/module/auth/auth-user.interface';
import { AccessLevel, Permission, Scope } from 'src/module/auth/enum/roles-xvi-fc.enum';
import { getEffectivePermissions } from 'src/module/auth/permissions.map';
import { FORM_STATUS, getFormStatusLabel, type FormStatusType } from 'src/common/constants/form-status.constants';
import type { XviFcApiResponse } from 'src/module/xvi-fc/common/response/xvi-fc-api-response';
import { xviFcSuccess } from 'src/module/xvi-fc/common/response/xvi-fc-response.util';
import { Ulb, UlbDocument } from 'src/schemas/ulb.schema';
import { XviFcBankAccount, XviFcBankAccountDocument } from 'src/schemas/xvi-fc/ulb/xvi-fc-bank-account.schema';
import {
  XviFcBankAccountFormLog,
  XviFcBankAccountFormLogDocument,
} from 'src/schemas/xvi-fc/ulb/xvi-fc-bank-account-form-log.schema';
import { toObjectIdString } from 'src/common/utils/objectid.util';
import { escapeRegex } from 'src/common/utils/regex.util';
import { resolveStateScopeFilter } from 'src/module/xvi-fc/common/utils/xvi-fc-scope-filter.util';
import {
  buildDecisionRecord,
  runBulkDecision,
  type BulkDecisionResult,
} from 'src/module/xvi-fc/common/utils/xvi-fc-decision.util';
import type { GetXviFcBankAccountQueryDto } from './dto/get-xvi-fc-bank-account-query.dto';
import { IFSC_REGEX } from './dto/submit-xvi-fc-bank-account.dto';
import type { SubmitXviFcBankAccountDto } from './dto/submit-xvi-fc-bank-account.dto';
import type { BankAccountDecisionDto } from './dto/bank-account-decision.dto';
import type { BulkBankAccountDecisionDto } from './dto/bulk-bank-account-decision.dto';
import type { BankAccountUlbSubmissionsQueryDto } from './dto/bank-account-ulb-submissions-query.dto';
import type {
  BankAccountFormLogEntry,
  VerifiedIfscDetails,
  XviFcBankAccountResponse,
  XviFcIfscLookupResponse,
} from './bank-account.types';
import {
  buildSafeBankAccountResponse,
  encryptAccountNumber,
  getAccountNumberLast4,
  hashAccountNumber,
  maskAccountNumber,
  type SafeBankAccountResponse,
} from './utils/bank-account-security.util';

export interface BankAccountPermissions {
  canReview: boolean;
  canApprove: boolean;
}

interface BankAccountSubmissionRow {
  ulbId: Types.ObjectId;
  ulbCode: string;
  ulbName: string;
  formStatus: FormStatusType;
  lastUpdatedAt: Date | null;
  bankAccountId: Types.ObjectId | null;
}

interface BankAccountSubmissionsFacetResult {
  data: BankAccountSubmissionRow[];
  totalCount: Array<{ count: number }>;
  counts: Array<{ _id: FormStatusType; count: number }>;
}

interface RazorpayIfscResponse {
  BANK?: string;
  IFSC?: string;
  BRANCH?: string;
  ADDRESS?: string;
  CITY?: string;
  STATE?: string;
  MICR?: string | null;
}

@Injectable()
export class BankAccountService {
  private readonly logger = new Logger(BankAccountService.name);

  constructor(
    @InjectModel(XviFcBankAccount.name)
    private readonly bankAccountModel: Model<XviFcBankAccountDocument>,
    @InjectModel(XviFcBankAccountFormLog.name)
    private readonly formLogModel: Model<XviFcBankAccountFormLogDocument>,
    @InjectModel(Ulb.name)
    private readonly ulbModel: Model<UlbDocument>,
    private readonly s3Service: S3Service,
  ) {}

  async getBankAccount(
    query: GetXviFcBankAccountQueryDto,
    user: AuthUser,
  ): Promise<XviFcApiResponse<(XviFcBankAccountResponse & { permissions: BankAccountPermissions }) | null>> {
    const ulbId = await this.resolveEffectiveUlbId(user, query.ulbId);
    await this.assertCanReadBankAccount(user, ulbId);

    const record = await this.bankAccountModel
      .findOne({
        ulb: new Types.ObjectId(ulbId),
        designYear: new Types.ObjectId(query.yearId),
      })
      .lean()
      .exec();

    const status = record?.currentFormStatus ?? FORM_STATUS.NOT_STARTED;
    const permissions = this.buildBankAccountPermissions(user, status);

    return xviFcSuccess(
      'Bank account form fetched.',
      record ? { ...buildSafeBankAccountResponse(record), permissions } : null,
    );
  }

  /** Mirrors Annual Accounts' getSignedUrl — generates a presigned S3 GET URL directly, no external service dependency. */
  async getProofSignedUrl(id: string, user: AuthUser): Promise<XviFcApiResponse<{ url: string }>> {
    if (!Types.ObjectId.isValid(id)) {
      throw new BadRequestException('Invalid bank account id.');
    }

    const record = await this.bankAccountModel.findById(id, 'ulb proofFile').lean().exec();
    if (!record) throw new NotFoundException('Bank account form not found');

    const ulbId = toObjectIdString(record.ulb);
    if (!ulbId) throw new NotFoundException('Bank account form not found');
    await this.assertCanReadBankAccount(user, ulbId);

    if (!record.proofFile?.s3Key) throw new NotFoundException('Proof document not found');

    const url = await this.s3Service.presignGet(record.proofFile.s3Key);
    return xviFcSuccess('Signed URL fetched.', { url });
  }

  /** Mirrors Annual Accounts' buildAnnualAccountPermissions — status-aware capability flags for the STATE reviewer UI. */
  private buildBankAccountPermissions(user: AuthUser, status: FormStatusType): BankAccountPermissions {
    // assertCanReadBankAccount already confirmed state-match for STATE scope by the time this runs.
    const hasStateAccess = user.scope === Scope.STATE || user.scope === Scope.ADMIN;
    const perms = getEffectivePermissions(user);
    const reviewable = status === FORM_STATUS.UNDER_REVIEW_BY_STATE;

    return {
      canReview: hasStateAccess && perms.includes(Permission.REVIEW_ULB_SUBMISSIONS) && reviewable,
      canApprove: hasStateAccess && perms.includes(Permission.APPROVE_ULB_SUBMISSIONS) && reviewable,
    };
  }

  async submitBankAccount(
    dto: SubmitXviFcBankAccountDto,
    user: AuthUser,
    ipAddress: string | null = null,
    userAgent: string | null = null,
  ): Promise<XviFcApiResponse<XviFcBankAccountResponse>> {
    const ulbId = await this.resolveEffectiveUlbId(user, dto.ulbId);
    await this.assertCanSubmitBankAccount(user, ulbId);

    const verifiedIfscDetails = await this.verifyIfscCode(dto.ifscCode);
    this.assertBankDetailsMatchVerifiedIfsc(dto.bankDetails, verifiedIfscDetails);

    const ulbObjectId = new Types.ObjectId(ulbId);
    const ulb = await this.ulbModel.findById(ulbId, 'state').lean().exec();
    const ulbStateId = toObjectIdString(ulb?.state);
    if (!ulbStateId) {
      throw new BadRequestException('ULB is not mapped to any state.');
    }
    if (ulbStateId !== dto.stateId) {
      throw new ForbiddenException('stateId does not match the ULB state.');
    }

    const stateObjectId = new Types.ObjectId(ulbStateId);
    const designYearObjectId = new Types.ObjectId(dto.designYearId);
    const now = new Date();

    const submittedBy = this.getAuthenticatedUserObjectId(user);
    const secureAccountFields = this.buildSecureAccountFields(dto.accountNumber);
    const proofFileS3Key = this.normalizeS3Key(dto.proofFile.s3Key);
    this.assertProofFileS3Key(proofFileS3Key, ulbId, dto.designYearId);

    const payload = {
      ulb: ulbObjectId,
      state: stateObjectId,
      designYear: designYearObjectId,
      ifscCode: dto.ifscCode,
      bankDetails: {
        name: dto.bankDetails.name,
        branch: dto.bankDetails.branch,
        address: dto.bankDetails.address,
        city: dto.bankDetails.city,
        state: dto.bankDetails.state,
        micr: dto.bankDetails.micr ?? null,
      },
      ...secureAccountFields,
      proofFile: {
        originalName: dto.proofFile.originalName,
        mimeType: dto.proofFile.mimeType,
        pages: dto.proofFile.mimeType === 'application/pdf' ? dto.proofFile.pages : null,
        sizeKb: dto.proofFile.sizeKb,
        s3Key: proofFileS3Key,
        sha256: dto.proofFile.sha256,
      },
      currentFormStatus: FORM_STATUS.UNDER_REVIEW_BY_STATE,
      currentFormStatusLabel: getFormStatusLabel(FORM_STATUS.UNDER_REVIEW_BY_STATE),
      submittedBy,
      submittedAt: now,
    };

    const record = await this.bankAccountModel
      .findOneAndUpdate(
        { ulb: ulbObjectId, designYear: designYearObjectId },
        { $set: payload },
        { upsert: true, new: true, runValidators: true },
      )
      .lean()
      .exec();

    await this.formLogModel.create({
      bankAccountId: record._id,
      ulb: ulbObjectId,
      designYear: designYearObjectId,
      action: 'SUBMITTED',
      toStatus: FORM_STATUS.UNDER_REVIEW_BY_STATE,
      toStatusLabel: getFormStatusLabel(FORM_STATUS.UNDER_REVIEW_BY_STATE),
      actorStage: 'ULB',
      userInfo: { userId: new Types.ObjectId(user._id), role: user.role, ipAddress, userAgent },
      filePath: proofFileS3Key,
    });

    return xviFcSuccess('Bank account form submitted.', buildSafeBankAccountResponse(record));
  }

  // ─── STATE review decision ───────────────────────────────────────────────────

  async decideBankAccount(
    id: string,
    dto: BankAccountDecisionDto,
    user: AuthUser,
    ipAddress: string | null = null,
    userAgent: string | null = null,
    batchId: string | null = null,
  ): Promise<XviFcApiResponse<XviFcBankAccountResponse>> {
    const record = await this.bankAccountModel.findById(new Types.ObjectId(id)).lean().exec();
    if (!record) throw new NotFoundException('Bank account form not found');
    await this.assertCanStateDecideBankAccount(user, record);

    const newStatus =
      dto.decision === 'APPROVED' ? FORM_STATUS.UNDER_REVIEW_BY_MOHUA : FORM_STATUS.RETURNED_BY_STATE;

    const decision = buildDecisionRecord(dto.decision, dto.note, user, ipAddress, userAgent);

    const updated = await this.bankAccountModel
      .findByIdAndUpdate(
        id,
        {
          $set: {
            currentFormStatus: newStatus,
            currentFormStatusLabel: getFormStatusLabel(newStatus),
            stateDecision: decision,
          },
        },
        { new: true },
      )
      .lean()
      .exec();

    await this.formLogModel.create({
      bankAccountId: new Types.ObjectId(id),
      ulb: record.ulb,
      designYear: record.designYear,
      action: dto.decision,
      toStatus: newStatus,
      toStatusLabel: getFormStatusLabel(newStatus),
      actorStage: 'STATE',
      userInfo: { userId: new Types.ObjectId(user._id), role: user.role, ipAddress, userAgent },
      ...(dto.note != null && { note: dto.note }),
      ...(record.proofFile?.s3Key != null && { filePath: record.proofFile.s3Key }),
      ...(batchId != null && { batchId }),
    });

    this.logger.log(`Bank account ${dto.decision.toLowerCase()} by STATE — id=${id} by user=${user._id}`);
    return xviFcSuccess('Bank account decision recorded.', buildSafeBankAccountResponse(updated!));
  }

  // ─── MoHUA review decision ────────────────────────────────────────────────────

  async decideMohuaBankAccount(
    id: string,
    dto: BankAccountDecisionDto,
    user: AuthUser,
    ipAddress: string | null = null,
    userAgent: string | null = null,
  ): Promise<XviFcApiResponse<XviFcBankAccountResponse>> {
    const record = await this.bankAccountModel.findById(new Types.ObjectId(id)).lean().exec();
    if (!record) throw new NotFoundException('Bank account form not found');
    this.assertCanMohuaDecideBankAccount(user, record);

    const newStatus =
      dto.decision === 'APPROVED' ? FORM_STATUS.SUBMISSION_ACKNOWLEDGED_BY_MOHUA : FORM_STATUS.RETURNED_BY_MOHUA;

    const decision = buildDecisionRecord(dto.decision, dto.note, user, ipAddress, userAgent);

    const updated = await this.bankAccountModel
      .findByIdAndUpdate(
        id,
        {
          $set: {
            currentFormStatus: newStatus,
            currentFormStatusLabel: getFormStatusLabel(newStatus),
            mohuaDecision: decision,
          },
        },
        { new: true },
      )
      .lean()
      .exec();

    await this.formLogModel.create({
      bankAccountId: new Types.ObjectId(id),
      ulb: record.ulb,
      designYear: record.designYear,
      action: dto.decision,
      toStatus: newStatus,
      toStatusLabel: getFormStatusLabel(newStatus),
      actorStage: 'MOHUA',
      userInfo: { userId: new Types.ObjectId(user._id), role: user.role, ipAddress, userAgent },
      ...(dto.note != null && { note: dto.note }),
      ...(record.proofFile?.s3Key != null && { filePath: record.proofFile.s3Key }),
    });

    this.logger.log(`Bank account ${dto.decision.toLowerCase()} by MoHUA — id=${id} by user=${user._id}`);
    return xviFcSuccess('Bank account decision recorded.', buildSafeBankAccountResponse(updated!));
  }

  // ─── Form status audit log ────────────────────────────────────────────────────

  async getBankAccountFormLogs(id: string, user: AuthUser): Promise<XviFcApiResponse<BankAccountFormLogEntry[]>> {
    if (!Types.ObjectId.isValid(id)) {
      throw new BadRequestException('Invalid bank account id.');
    }

    const record = await this.bankAccountModel.findById(id, 'ulb').lean().exec();
    if (!record) throw new NotFoundException('Bank account form not found');
    await this.assertCanViewBankAccountFormLogs(user, record);

    const logs = await this.formLogModel
      .find({ bankAccountId: new Types.ObjectId(id) })
      .sort({ createdAt: -1 })
      .lean()
      .exec();

    return xviFcSuccess(
      'Bank account form log fetched.',
      logs.map((log) => ({
        action: log.action,
        toStatus: log.toStatus,
        toStatusLabel: log.toStatusLabel,
        actorStage: log.actorStage,
        actorRole: log.userInfo.role,
        note: log.note ?? null,
        filePath: log.filePath ?? null,
        batchId: log.batchId ?? null,
        createdAt: (log as unknown as { createdAt: Date }).createdAt,
      })),
    );
  }

  /** Read-only history view — STATE/MOHUA/ADMIN reviewers only, no form-status gating (unlike decide). */
  private async assertCanViewBankAccountFormLogs(user: AuthUser, record: { ulb: Types.ObjectId }): Promise<void> {
    if (user.scope === Scope.ADMIN) return;

    const perms = getEffectivePermissions(user);

    if (user.scope === Scope.STATE) {
      if (!perms.includes(Permission.REVIEW_ULB_SUBMISSIONS)) {
        throw new ForbiddenException('You do not have permission to review ULB submissions');
      }
      const userStateId = toObjectIdString(user.state);
      const ulb = await this.ulbModel.findById(record.ulb, 'state').lean().exec();
      const ulbStateId = toObjectIdString(ulb?.state);
      if (!userStateId || !ulbStateId || userStateId !== ulbStateId) {
        throw new ForbiddenException('You can only view bank account forms within your own state');
      }
      return;
    }

    if (user.scope === Scope.MOHUA) {
      if (!perms.includes(Permission.REVIEW_STATE_SUBMISSIONS)) {
        throw new ForbiddenException('You do not have permission to review state submissions');
      }
      return;
    }

    throw new ForbiddenException('Access denied.');
  }

  // ─── Bulk STATE review decision ───────────────────────────────────────────────

  async bulkDecideBankAccount(
    dto: BulkBankAccountDecisionDto,
    user: AuthUser,
    ipAddress: string | null = null,
    userAgent: string | null = null,
  ): Promise<XviFcApiResponse<BulkDecisionResult>> {
    const result = await runBulkDecision(dto.ids, (id, batchId) =>
      this.decideBankAccount(id, { decision: dto.decision, note: dto.note }, user, ipAddress, userAgent, batchId),
    );

    this.logger.log(
      `Bulk bank account decision — batchId=${result.batchId} decision=${dto.decision} succeeded=${result.succeeded}/${dto.ids.length} by user=${user._id}`,
    );

    return xviFcSuccess('Bulk decision processed.', result);
  }

  // ─── State-scoped ULB submissions list ───────────────────────────────────────

  /**
   * Paginated list of every ULB in the requester's state for a given design year,
   * joined against that ULB's bank account status. ULB is the primary collection
   * (left-joined to the bank account doc) so ULBs that haven't started still appear,
   * reported as NOT_STARTED.
   */
  async listUlbBankAccounts(
    dto: BankAccountUlbSubmissionsQueryDto,
    user: AuthUser,
  ): Promise<
    XviFcApiResponse<{
      total: number;
      page: number;
      pageSize: number;
      rows: BankAccountSubmissionRow[];
      counts: Record<FormStatusType, number>;
    }>
  > {
    if (user.scope !== Scope.STATE && user.scope !== Scope.ADMIN) {
      throw new ForbiddenException('Only STATE or ADMIN users may list ULB submissions');
    }
    const perms = getEffectivePermissions(user);
    if (!perms.includes(Permission.REVIEW_ULB_SUBMISSIONS)) {
      throw new ForbiddenException('You do not have permission to review ULB submissions');
    }

    const stateId = resolveStateScopeFilter(user, dto.stateId);

    const matchStage: Record<string, unknown> = { isActive: true };
    if (stateId) matchStage.state = stateId;
    if (dto.search?.trim()) {
      const regex = new RegExp(escapeRegex(dto.search.trim()), 'i');
      matchStage.$or = [{ name: regex }, { code: regex }];
    }

    const sortField = dto.sortField ?? 'ulbName';
    const sortDirection = dto.sortDirection === 'desc' ? -1 : 1;
    const sortStage: Record<string, 1 | -1> =
      sortField === 'formStatus' ? { formStatus: sortDirection } : { name: sortDirection };

    const page = dto.page ?? 1;
    const pageSize = dto.pageSize ?? 20;
    const designYearObjectId = new Types.ObjectId(dto.designYearId);

    const pipeline: PipelineStage[] = [
      { $match: matchStage },
      {
        $lookup: {
          from: 'xvifc_bankaccounts',
          let: { ulbId: '$_id' },
          pipeline: [
            {
              $match: {
                $expr: { $and: [{ $eq: ['$ulb', '$$ulbId'] }, { $eq: ['$designYear', designYearObjectId] }] },
              },
            },
          ],
          as: 'bankAccount',
        },
      },
      { $addFields: { bankAccount: { $arrayElemAt: ['$bankAccount', 0] } } },
      {
        $addFields: {
          formStatus: { $ifNull: ['$bankAccount.currentFormStatus', FORM_STATUS.NOT_STARTED] },
          lastUpdatedAt: { $ifNull: ['$bankAccount.updatedAt', null] },
        },
      },
    ];

    const statusMatch: PipelineStage.FacetPipelineStage[] =
      dto.status?.length ? [{ $match: { formStatus: { $in: dto.status } } }] : [];

    pipeline.push({
      $facet: {
        data: [
          ...statusMatch,
          { $sort: sortStage },
          { $skip: (page - 1) * pageSize },
          { $limit: pageSize },
          {
            $project: {
              _id: 0,
              ulbId: '$_id',
              ulbCode: '$code',
              ulbName: '$name',
              formStatus: 1,
              lastUpdatedAt: 1,
              bankAccountId: { $ifNull: ['$bankAccount._id', null] },
            },
          },
        ],
        totalCount: [...statusMatch, { $count: 'count' }],
        counts: [{ $group: { _id: '$formStatus', count: { $sum: 1 } } }],
      },
    });

    const [result] = await this.ulbModel.aggregate<BankAccountSubmissionsFacetResult>(pipeline).exec();
    const rows = result?.data ?? [];
    const total = result?.totalCount?.[0]?.count ?? 0;

    const counts = Object.fromEntries(
      Object.values(FORM_STATUS)
        .filter((status): status is FormStatusType => status !== FORM_STATUS.NO_STATUS)
        .map((status) => [status, result?.counts.find((c) => c._id === status)?.count ?? 0]),
    ) as Record<FormStatusType, number>;

    return xviFcSuccess('ULB bank account submissions fetched.', { total, page, pageSize, rows, counts });
  }

  /**
   * STATE users are always scoped to their own state; ADMIN may optionally pass one, else sees all.
   * Checks the ULB's current state live (same pattern as assertCanReadBankAccount) rather than the
   * `state` snapshot stored on the bank account record itself — that snapshot is captured once at
   * submission time and goes stale if the ULB's state mapping is corrected afterward.
   */
  private async assertCanStateDecideBankAccount(
    user: AuthUser,
    record: { ulb: Types.ObjectId; currentFormStatus: FormStatusType },
  ): Promise<void> {
    if (user.scope !== Scope.STATE && user.scope !== Scope.ADMIN) {
      throw new ForbiddenException('Only STATE or ADMIN users may decide bank account forms');
    }
    if (user.scope === Scope.STATE) {
      const userStateId = toObjectIdString(user.state);
      const ulb = await this.ulbModel.findById(record.ulb, 'state').lean().exec();
      const ulbStateId = toObjectIdString(ulb?.state);
      if (!userStateId || !ulbStateId || userStateId !== ulbStateId) {
        throw new ForbiddenException('You can only decide bank account forms within your own state');
      }
    }
    const perms = getEffectivePermissions(user);
    if (!perms.includes(Permission.APPROVE_ULB_SUBMISSIONS)) {
      throw new ForbiddenException('You do not have permission to review ULB submissions');
    }
    if (record.currentFormStatus !== FORM_STATUS.UNDER_REVIEW_BY_STATE) {
      throw new ForbiddenException(
        `This form cannot be decided while its status is ${getFormStatusLabel(record.currentFormStatus)}.`,
      );
    }
  }

  private assertCanMohuaDecideBankAccount(user: AuthUser, record: { currentFormStatus: FormStatusType }): void {
    if (user.scope !== Scope.MOHUA && user.scope !== Scope.ADMIN) {
      throw new ForbiddenException('Only MOHUA or ADMIN users may decide bank account forms');
    }
    const perms = getEffectivePermissions(user);
    if (!perms.includes(Permission.APPROVE_STATE_SUBMISSIONS)) {
      throw new ForbiddenException('You do not have permission to review state submissions');
    }
    if (record.currentFormStatus !== FORM_STATUS.UNDER_REVIEW_BY_MOHUA) {
      throw new ForbiddenException(
        `This form cannot be decided while its status is ${getFormStatusLabel(record.currentFormStatus)}.`,
      );
    }
  }

  async lookupIfsc(ifscCode: string): Promise<XviFcApiResponse<XviFcIfscLookupResponse>> {
    const normalizedIfsc = (ifscCode ?? '').trim().toUpperCase();
    if (!IFSC_REGEX.test(normalizedIfsc)) {
      throw new BadRequestException('ifscCode must be a valid Indian IFSC code.');
    }

    try {
      const { data } = await axios.get<RazorpayIfscResponse>(
        `https://ifsc.razorpay.com/${encodeURIComponent(normalizedIfsc)}`,
      );

      if (!data?.BANK || !data?.BRANCH) {
        throw new NotFoundException('No bank details found for this IFSC code.');
      }

      return xviFcSuccess('IFSC details fetched.', {
        ifscCode: normalizedIfsc,
        bankDetails: {
          name: data.BANK,
          branch: data.BRANCH,
          address: data.ADDRESS ?? '',
          city: data.CITY ?? '',
          state: data.STATE,
          micr: data.MICR ?? null,
        },
      });
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error;
      }

      if (axios.isAxiosError(error) && error.response?.status === 404) {
        throw new NotFoundException('No bank details found for this IFSC code.');
      }

      throw new ServiceUnavailableException('Unable to fetch IFSC details. Please try again.');
    }
  }

  async resolveEffectiveUlbId(user: AuthUser, requestedUlbId?: string): Promise<string> {
    const normalizedRequestedUlbId = requestedUlbId?.trim();
    if (normalizedRequestedUlbId && !Types.ObjectId.isValid(normalizedRequestedUlbId)) {
      throw new BadRequestException('Invalid ulbId.');
    }

    if (user.scope === Scope.ULB) {
      const userUlbId = toObjectIdString(user.ulb);
      if (!userUlbId || !Types.ObjectId.isValid(userUlbId)) {
        throw new ForbiddenException('Your account is not mapped to any ULB.');
      }
      if (normalizedRequestedUlbId && normalizedRequestedUlbId !== userUlbId) {
        throw new ForbiddenException('You can only access your own ULB bank account form.');
      }
      return userUlbId;
    }

    if (user.scope === Scope.STATE) {
      if (!normalizedRequestedUlbId) {
        throw new BadRequestException('ulbId is required for STATE users.');
      }
      return normalizedRequestedUlbId;
    }

    if (user.scope === Scope.ADMIN) {
      if (!normalizedRequestedUlbId) {
        throw new BadRequestException('ulbId is required for ADMIN users.');
      }
      return normalizedRequestedUlbId;
    }

    throw new ForbiddenException('Access denied.');
  }

  async assertCanReadBankAccount(user: AuthUser, ulbId: string): Promise<void> {
    this.assertValidUlbId(ulbId);

    if (user.scope === Scope.ADMIN) return;

    if (user.scope === Scope.ULB) {
      const userUlbId = toObjectIdString(user.ulb);
      if (!userUlbId || userUlbId !== ulbId) {
        throw new ForbiddenException('You can only access your own ULB bank account form.');
      }
      return;
    }

    if (user.scope === Scope.STATE) {
      const userStateId = toObjectIdString(user.state);
      if (!userStateId || !Types.ObjectId.isValid(userStateId)) {
        throw new ForbiddenException('Your account is not mapped to any state.');
      }

      const ulb = await this.ulbModel.findById(ulbId, 'state').lean().exec();
      const ulbStateId = toObjectIdString(ulb?.state);
      if (!ulbStateId || ulbStateId !== userStateId) {
        throw new ForbiddenException('You can only access ULB bank account forms within your own state.');
      }
      return;
    }

    throw new ForbiddenException('Access denied.');
  }

  async assertCanSubmitBankAccount(user: AuthUser, ulbId: string): Promise<void> {
    this.assertValidUlbId(ulbId);

    if (user.scope === Scope.ADMIN) return;

    if (user.scope === Scope.ULB) {
      if (user.accessLevel === AccessLevel.VIEWER) {
        throw new ForbiddenException('Viewers cannot submit bank account forms.');
      }

      const userUlbId = toObjectIdString(user.ulb);
      if (!userUlbId || userUlbId !== ulbId) {
        throw new ForbiddenException('You can only submit your own ULB bank account form.');
      }
      return;
    }

    if (user.scope === Scope.STATE) {
      throw new ForbiddenException('STATE users cannot submit ULB bank account forms.');
    }

    throw new ForbiddenException('Access denied.');
  }

  private toSafeResponse(record: XviFcBankAccountDocument): SafeBankAccountResponse {
    return buildSafeBankAccountResponse(record);
  }

  private assertValidUlbId(ulbId: string): void {
    if (!ulbId || !Types.ObjectId.isValid(ulbId)) {
      throw new BadRequestException('Invalid ulbId.');
    }
  }

  private getAuthenticatedUserObjectId(user: AuthUser): Types.ObjectId {
    if (!user?._id || !Types.ObjectId.isValid(user._id)) {
      throw new ForbiddenException('Authenticated user id is missing or invalid.');
    }

    return new Types.ObjectId(user._id);
  }

  private buildSecureAccountFields(accountNumber: string): {
    accountNumberEncrypted: string;
    accountNumberHash: string;
    accountNumberMasked: string;
    accountNumberLast4: string;
  } {
    try {
      return {
        accountNumberEncrypted: encryptAccountNumber(accountNumber),
        accountNumberHash: hashAccountNumber(accountNumber),
        accountNumberMasked: maskAccountNumber(accountNumber),
        accountNumberLast4: getAccountNumberLast4(accountNumber),
      };
    } catch (error) {
      if (error instanceof Error && error.message.startsWith('BANK_ACCOUNT_')) {
        this.logger.error(error.message);
        throw new ServiceUnavailableException(
          'Bank account security configuration is invalid. Please contact support.',
        );
      }

      throw error;
    }
  }

  private normalizeS3Key(value: string): string {
    const trimmedValue = value.trim();
    if (!trimmedValue) return trimmedValue;

    if (/^https?:\/\//i.test(trimmedValue)) {
      try {
        return new URL(trimmedValue).pathname.replace(/^\/+/, '');
      } catch {
        return this.stripUrlQuery(trimmedValue).replace(/^\/+/, '');
      }
    }

    if (/^s3:\/\//i.test(trimmedValue)) {
      try {
        return new URL(trimmedValue).pathname.replace(/^\/+/, '');
      } catch {
        return this.stripUrlQuery(trimmedValue).replace(/^s3:\/\/[^/]+\/?/i, '');
      }
    }

    return this.stripUrlQuery(trimmedValue).replace(/^\/+/, '');
  }

  private assertProofFileS3Key(s3Key: string, ulbId: string, designYearId: string): void {
    const expectedPrefix = `xvi-fc/bank-account/${ulbId}/${designYearId}/proof/`;
    if (!s3Key.startsWith(expectedPrefix)) {
      throw new BadRequestException(
        'proofFile.s3Key must be a bank-account proof object key for this ULB and design year.',
      );
    }
  }

  private stripUrlQuery(fileUrl: string): string {
    return fileUrl.split('?')[0];
  }

  private async verifyIfscCode(ifscCode: string): Promise<VerifiedIfscDetails | null> {
    void ifscCode;
    // TODO: Wire this to the approved IFSC master/Razorpay verification source when available.
    // The method exists deliberately so server-side verification is not skipped silently.
    return null;
  }

  private assertBankDetailsMatchVerifiedIfsc(
    bankDetails: SubmitXviFcBankAccountDto['bankDetails'],
    verifiedIfscDetails: VerifiedIfscDetails | null,
  ): void {
    if (!verifiedIfscDetails) return;

    const comparisons: Array<[string, string | null | undefined, string | null | undefined]> = [
      ['bankDetails.name', bankDetails.name, verifiedIfscDetails.bank],
      ['bankDetails.branch', bankDetails.branch, verifiedIfscDetails.branch],
      ['bankDetails.address', bankDetails.address, verifiedIfscDetails.address],
      ['bankDetails.city', bankDetails.city, verifiedIfscDetails.city],
      ['bankDetails.state', bankDetails.state, verifiedIfscDetails.state],
      ['bankDetails.micr', bankDetails.micr ?? null, verifiedIfscDetails.micr ?? null],
    ];

    const mismatch = comparisons.find(([, submitted, verified]) => {
      if (verified === undefined || verified === null || verified === '') return false;
      return (
        String(submitted ?? '')
          .trim()
          .toUpperCase() !== String(verified).trim().toUpperCase()
      );
    });

    if (mismatch) {
      throw new BadRequestException(`${mismatch[0]} does not match the verified IFSC details.`);
    }
  }
}
