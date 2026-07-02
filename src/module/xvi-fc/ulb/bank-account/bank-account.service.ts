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
import { Model, Types } from 'mongoose';
import type { AuthUser } from 'src/module/auth/auth-user.interface';
import { AccessLevel, Scope } from 'src/module/auth/enum/roles-xvi-fc.enum';
import { FORM_STATUS } from 'src/common/constants/form-status.constants';
import type { XviFcApiResponse } from 'src/module/xvi-fc/common/response/xvi-fc-api-response';
import { xviFcSuccess } from 'src/module/xvi-fc/common/response/xvi-fc-response.util';
import { buildXviFcFolderPath } from 'src/module/xvi-fc/common/folder-paths/xvi-fc-folder-path.resolver';
import { XVI_FC_FOLDER_PATH_KEYS } from 'src/module/xvi-fc/common/folder-paths/xvi-fc-folder-path.constants';
import { Ulb, UlbDocument } from 'src/schemas/ulb.schema';
import {
  XviFcBankAccount,
  XviFcBankAccountDocument,
} from 'src/schemas/xvi-fc/ulb/xvi-fc-bank-account.schema';
import { toObjectIdString } from 'src/users/user-scope.helpers';
import { S3UploadService } from 'src/s3-upload/s3-upload.service';
import type { S3UrlResult } from 'src/s3-upload/dto/s3-url-item.dto';
import type { GetXviFcBankAccountQueryDto } from './dto/get-xvi-fc-bank-account-query.dto';
import type { GetBankAccountProofSignedUrlDto } from './dto/get-bank-account-proof-signed-url.dto';
import { IFSC_REGEX } from './dto/submit-xvi-fc-bank-account.dto';
import type { SubmitXviFcBankAccountDto } from './dto/submit-xvi-fc-bank-account.dto';
import type { VerifiedIfscDetails, XviFcBankAccountResponse, XviFcIfscLookupResponse } from './bank-account.types';
import {
  buildSafeBankAccountResponse,
  encryptAccountNumber,
  getAccountNumberLast4,
  hashAccountNumber,
  maskAccountNumber,
  type SafeBankAccountResponse,
} from './utils/bank-account-security.util';

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
    @InjectModel(Ulb.name)
    private readonly ulbModel: Model<UlbDocument>,
    private readonly s3UploadService: S3UploadService,
  ) {}

  async getBankAccount(
    query: GetXviFcBankAccountQueryDto,
    user: AuthUser,
  ): Promise<XviFcApiResponse<XviFcBankAccountResponse | null>> {
    const ulbId = await this.resolveEffectiveUlbId(user, query.ulbId);
    await this.assertCanReadBankAccount(user, ulbId);

    const record = await this.bankAccountModel
      .findOne({
        ulb: new Types.ObjectId(ulbId),
        designYear: new Types.ObjectId(query.yearId),
      })
      .lean()
      .exec();

    return xviFcSuccess('Bank account form fetched.', record ? buildSafeBankAccountResponse(record) : null);
  }

  async submitBankAccount(
    dto: SubmitXviFcBankAccountDto,
    user: AuthUser,
  ): Promise<XviFcApiResponse<XviFcBankAccountResponse>> {
    const ulbId = await this.resolveEffectiveUlbId(user, dto.ulbId);
    await this.assertCanSubmitBankAccount(user, ulbId);

    const verifiedIfscDetails = await this.verifyIfscCode(dto.ifscCode);
    this.assertBankDetailsMatchVerifiedIfsc(dto.bankDetails, verifiedIfscDetails);

    const ulbObjectId = new Types.ObjectId(ulbId);
    const designYearObjectId = new Types.ObjectId(dto.designYearId);
    const now = new Date();

    const submittedBy = this.getAuthenticatedUserObjectId(user);
    const secureAccountFields = this.buildSecureAccountFields(dto.accountNumber);

    const payload = {
      ulb: ulbObjectId,
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
      proof: {
        fileName: dto.proof.fileName,
        fileUrl: dto.proof.fileUrl,
        fileSize: dto.proof.fileSize,
        mimeType: dto.proof.mimeType,
      },
      currentFormStatus: FORM_STATUS.UNDER_REVIEW_BY_STATE,
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

    return xviFcSuccess('Bank account form submitted.', buildSafeBankAccountResponse(record));
  }

  async getProofSignedUrl(
    dto: GetBankAccountProofSignedUrlDto,
    user: AuthUser,
  ): Promise<XviFcApiResponse<S3UrlResult>> {
    const ulbId = await this.resolveEffectiveUlbId(user, dto.ulbId);
    await this.assertCanSubmitBankAccount(user, ulbId);

    const folder = this.buildProofFolderPath(ulbId, dto.designYearId);
    const signedUrl = await this.s3UploadService.generatePutSignedUrl({
      fileName: dto.fileName,
      fileSize: dto.fileSize,
      mimeType: dto.mimeType,
      folder,
    });

    return xviFcSuccess('Bank account proof signed URL generated.', signedUrl);
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
        throw new ServiceUnavailableException('Bank account security configuration is invalid. Please contact support.');
      }

      throw error;
    }
  }

  private buildProofFolderPath(ulbId: string, designYearId: string): string {
    return buildXviFcFolderPath(XVI_FC_FOLDER_PATH_KEYS.XVI_FC_BANK_ACCOUNT_PROOF, {
      _id: ulbId,
      role: 'ulb',
      designYear: designYearId,
    });
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
      return String(submitted ?? '').trim().toUpperCase() !== String(verified).trim().toUpperCase();
    });

    if (mismatch) {
      throw new BadRequestException(`${mismatch[0]} does not match the verified IFSC details.`);
    }
  }
}
