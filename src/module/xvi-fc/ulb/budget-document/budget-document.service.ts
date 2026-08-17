import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { FileTokenService } from 'src/core/file-token/file-token.service';
import type { AuthUser } from 'src/module/auth/auth-user.interface';
import { AccessLevel, Scope } from 'src/module/auth/enum/roles-xvi-fc.enum';
import { CANTONMENT_BOARD_XVIFC_INELIGIBLE_MESSAGE } from 'src/module/ulb-eligibility/ulb-eligibility.constants';
import { UlbEligibilityService } from 'src/module/ulb-eligibility/ulb-eligibility.service';
import type { XviFcApiResponse } from 'src/module/xvi-fc/common/response/xvi-fc-api-response';
import { xviFcSuccess } from 'src/module/xvi-fc/common/response/xvi-fc-response.util';
import { toObjectIdString } from 'src/common/utils/objectid.util';
import { BudgetDocument, BudgetDocumentDoc } from 'src/schemas/budget-document.schema';
import { Year, YearDocument } from 'src/schemas/year.schema';
import type { UploadBudgetDocumentDto } from './dto/upload-budget-document.dto';

interface BudgetDocumentFile {
  type: string;
  url: string;
  name: string;
  source: string;
  createdAt: Date;
}

export interface BudgetDocumentYearResponse {
  designYearId: string;
  designYear: string;
  file: { name: string; uploadedAt: Date; url: string | null } | null;
}

@Injectable()
export class BudgetDocumentService {
  constructor(
    @InjectModel(BudgetDocument.name)
    private readonly model: Model<BudgetDocumentDoc>,
    @InjectModel(Year.name)
    private readonly yearModel: Model<YearDocument>,
    private readonly ulbEligibilityService: UlbEligibilityService,
    private readonly fileTokenService: FileTokenService,
  ) {}

  async getByUlbAndYear(user: AuthUser, designYearId: string): Promise<XviFcApiResponse<BudgetDocumentYearResponse>> {
    const ulbId = this.resolveUlbId(user);
    const { id: designYearObjId, label: designYear } = await this.resolveDesignYear(designYearId);

    const doc = await this.model
      .findOne({ ulb: new Types.ObjectId(ulbId), 'yearsData.designYearId': designYearObjId }, { 'yearsData.$': 1 })
      .lean()
      .exec();

    // Only a 'ulb'-sourced file counts as "uploaded via this feature" — a lingering legacy
    // 'cfr'-sourced file for the same year must never show as already-uploaded here.
    const ulbFile = doc?.yearsData?.[0]?.files?.find((f) => f.source === 'ulb') ?? null;

    return xviFcSuccess('Budget document fetched.', this.toResponse(designYearId, designYear, ulbFile ?? null));
  }

  async upload(dto: UploadBudgetDocumentDto, user: AuthUser): Promise<XviFcApiResponse<BudgetDocumentYearResponse>> {
    const ulbId = this.resolveUlbId(user);
    await this.ulbEligibilityService.assertUlbEligibleForGrantCycle(
      ulbId,
      'XVIFC',
      CANTONMENT_BOARD_XVIFC_INELIGIBLE_MESSAGE,
    );
    if (user.accessLevel === AccessLevel.VIEWER) {
      throw new ForbiddenException('Viewers cannot upload the budget document.');
    }

    const { id: designYearObjId, label: designYear } = await this.resolveDesignYear(dto.designYearId);
    this.assertS3KeyMatchesYear(dto.s3Key, designYear);

    const ulbObjId = new Types.ObjectId(ulbId);
    const newFile: BudgetDocumentFile = {
      type: 'pdf',
      url: `/${dto.s3Key.replace(/^\/+/, '')}`,
      name: dto.originalName,
      source: 'ulb',
      createdAt: new Date(),
    };

    const existing = await this.model
      .findOne({ ulb: ulbObjId, 'yearsData.designYearId': designYearObjId }, { 'yearsData.$': 1 })
      .lean()
      .exec();

    if (existing) {
      // Replace only the 'ulb'-sourced file — any other-sourced file (e.g. legacy 'cfr') for
      // this year is preserved. New upload goes first: resources-section's public downloads
      // pipeline reads files[0] for this year, so this keeps the current self-service upload
      // what that page serves, without deleting the older fallback file.
      const preservedFiles = (existing.yearsData[0]?.files ?? []).filter((f) => f.source !== 'ulb');
      await this.model
        .findOneAndUpdate(
          { ulb: ulbObjId, 'yearsData.designYearId': designYearObjId },
          { $set: { 'yearsData.$.files': [newFile, ...preservedFiles], 'yearsData.$.designYear': designYear } },
          { runValidators: true },
        )
        .exec();
      return xviFcSuccess('Budget document uploaded.', this.toResponse(dto.designYearId, designYear, newFile));
    }

    const sequence = this.computeSequence(designYear);
    const pushNewYearEntry = () =>
      this.model
        .findOneAndUpdate(
          { ulb: ulbObjId, 'yearsData.designYearId': { $ne: designYearObjId } },
          {
            $setOnInsert: { ulb: ulbObjId },
            $push: { yearsData: { designYearId: designYearObjId, designYear, sequence, files: [newFile] } },
          },
          { upsert: true, runValidators: true },
        )
        .exec();

    try {
      await pushNewYearEntry();
    } catch (err) {
      if (!this.isDuplicateKeyError(err)) throw err;
      // Lost a race with a concurrent first-ever upload for this ULB (a different year) — the
      // ULB document now exists, so retrying the same filter matches-and-pushes instead of
      // attempting a second insert.
      await pushNewYearEntry();
    }

    return xviFcSuccess('Budget document uploaded.', this.toResponse(dto.designYearId, designYear, newFile));
  }

  private resolveUlbId(user: AuthUser): string {
    if (user.scope !== Scope.ULB) {
      throw new ForbiddenException('Only ULB users may access the budget document.');
    }
    const ulbId = toObjectIdString(user.ulb);
    if (!ulbId) {
      throw new ForbiddenException('Your account is not mapped to any ULB.');
    }
    return ulbId;
  }

  private async resolveDesignYear(designYearId: string): Promise<{ id: Types.ObjectId; label: string }> {
    if (!Types.ObjectId.isValid(designYearId)) {
      throw new BadRequestException('Invalid yearId.');
    }
    const year = await this.yearModel.findById(designYearId, 'year').lean().exec();
    if (!year) {
      throw new NotFoundException('Design year not found.');
    }
    return { id: new Types.ObjectId(designYearId), label: year.year };
  }

  private assertS3KeyMatchesYear(s3Key: string, designYear: string): void {
    const expectedPrefix = `budgets/${designYear}/`;
    if (!s3Key.startsWith(expectedPrefix)) {
      throw new BadRequestException(`file.s3Key must be an object key under ${expectedPrefix}.`);
    }
  }

  /**
   * No canonical source for `sequence` exists anywhere in this backend (the Year schema has no
   * such field, and resources-section's getBudgetPipeline never reads it) — derived from the
   * observed legacy pattern (2020-21→6 … 2025-26→11): (FY start year) - 2014. Unconfirmed formula,
   * flagged as inferred rather than verified.
   */
  private computeSequence(designYear: string): number {
    const startYear = parseInt(designYear.split('-')[0], 10);
    return startYear - 2014;
  }

  private isDuplicateKeyError(err: unknown): boolean {
    return typeof err === 'object' && err !== null && (err as { code?: number }).code === 11000;
  }

  private signInline(url: string | null | undefined): string | null {
    return url ? this.fileTokenService.signFileUrl(url, 'inline') : null;
  }

  private toResponse(
    designYearId: string,
    designYear: string,
    file: BudgetDocumentFile | null,
  ): BudgetDocumentYearResponse {
    return {
      designYearId,
      designYear,
      file: file ? { name: file.name, uploadedAt: file.createdAt, url: this.signInline(file.url) } : null,
    };
  }
}
