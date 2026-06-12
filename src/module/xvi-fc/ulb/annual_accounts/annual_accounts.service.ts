import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';

import { AnnualAccountStatus, XviFcAnnualAccount, XviFcAnnualAccountDocument } from '../../../../schemas/xvi-fc/annual-account.schema';
import { AnnualAccountDocumentDto, SaveAnnualAccountDto, YearSectionDto } from './dto/create-annual_account.dto';
import type { AuthUser } from 'src/module/auth/auth-user.interface';

@Injectable()
export class AnnualAccountsService {
  constructor(
    @InjectModel(XviFcAnnualAccount.name)
    private readonly model: Model<XviFcAnnualAccountDocument>,
  ) {}

  async upsert(dto: SaveAnnualAccountDto, user: AuthUser): Promise<XviFcAnnualAccountDocument> {
    const ulbId = new Types.ObjectId(dto.ulb);
    const yearId = new Types.ObjectId(dto.design_year);
    const userId = new Types.ObjectId(user._id);
    const filter = { ulb: ulbId, design_year: yearId };

    const existing = await this.model.findOne(filter).lean().exec();

    const incomingStatus = dto.status ?? AnnualAccountStatus.DRAFT;
    const incomingIsDraft = dto.isDraft ?? true;

    if (!existing) {
      return this.model.create({
        ulb: ulbId,
        design_year: yearId,
        auditedData: dto.auditedData ? this.buildSection(dto.auditedData, [], user) : undefined,
        unauditedData: dto.unauditedData ? this.buildSection(dto.unauditedData, [], user) : undefined,
        status: incomingStatus,
        isDraft: incomingIsDraft,
        isActive: true,
        createdBy: userId,
        modifiedBy: userId,
      });
    }

    const $set: Record<string, unknown> = {
      modifiedBy: userId,
      status: incomingStatus,
      isDraft: incomingIsDraft,
    };

    if (dto.auditedData) {
      $set['auditedData'] = this.buildSection(dto.auditedData, existing.auditedData?.documents ?? [], user);
    }

    if (dto.unauditedData) {
      $set['unauditedData'] = this.buildSection(dto.unauditedData, existing.unauditedData?.documents ?? [], user);
    }

    return this.model.findOneAndUpdate(filter, { $set }, { new: true }).lean().exec() as Promise<XviFcAnnualAccountDocument>;
  }

  async findOne(ulbId: string, yearId: string): Promise<XviFcAnnualAccountDocument> {
    const doc = await this.model
      .findOne({ ulb: new Types.ObjectId(ulbId), design_year: new Types.ObjectId(yearId) })
      .populate('auditedData.documents.userInfo.userId', 'name')
      .populate('unauditedData.documents.userInfo.userId', 'name')
      .lean()
      .exec();

    if (!doc) throw new NotFoundException('Annual account data not found');
    return doc as XviFcAnnualAccountDocument;
  }

  private buildSection(
    dto: YearSectionDto,
    existingDocs: Array<{ docId: string; version: string }>,
    user: AuthUser,
  ) {
    return {
      yearId: new Types.ObjectId(dto.yearId),
      year: dto.year,
      documents: this.mergeDocuments(existingDocs, dto.documents, user),
    };
  }

  private mergeDocuments(
    existing: Array<{ docId: string; version: string }>,
    incoming: AnnualAccountDocumentDto[],
    user: AuthUser,
  ) {
    const merged = existing.map((d) => ({ ...d }));
    const uploaderInfo = { userId: new Types.ObjectId(user._id), role: user.role };

    for (const doc of incoming) {
      const idx = merged.findIndex((d) => d.docId === doc.docId);
      const newEntry = {
        docId: doc.docId,
        type: doc.type,
        fileName: doc.fileName,
        fileSize: doc.fileSize,
        pages: doc.pages ?? 0,
        mimeType: doc.mimeType,
        filePath: doc.filePath,
        fileUrl: doc.fileUrl,
        version: idx >= 0 ? this.nextVersion(merged[idx].version) : 'v1',
        userInfo: uploaderInfo,
        uploadedAt: new Date(),
      };

      if (idx >= 0) {
        merged[idx] = newEntry;
      } else {
        merged.push(newEntry);
      }
    }

    return merged;
  }

  private nextVersion(current: string): string {
    const n = parseInt(current.replace('v', ''), 10);
    return `v${(isNaN(n) ? 1 : n) + 1}`;
  }
}
