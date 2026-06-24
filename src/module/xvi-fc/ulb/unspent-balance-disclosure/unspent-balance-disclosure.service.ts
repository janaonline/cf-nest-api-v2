import { ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { FilterQuery, Model, Types, UpdateQuery } from 'mongoose';
import {
  XviFcUnspentBalanceDisclosure,
  XviFcUnspentBalanceDisclosureDocument,
} from '../../../../schemas/xvi-fc/unspent-balance-disclosure.schema';
import { SubmitDisclosureDto } from './dto/submit-disclosure.dto';
import { UpdateDisclosureDto } from './dto/update-disclosure.dto';
import { AuthUser } from '../../../auth/auth-user.interface';
import { S3Service } from '../../../../core/s3/s3.service';

@Injectable()
export class UnspentBalanceDisclosureService {
  constructor(
    @InjectModel(XviFcUnspentBalanceDisclosure.name)
    private readonly model: Model<XviFcUnspentBalanceDisclosureDocument>,
    private readonly s3: S3Service,
  ) {}

  async submit(
    dto: SubmitDisclosureDto,
    user: AuthUser,
  ): Promise<XviFcUnspentBalanceDisclosureDocument> {
    if (!user.ulb) throw new ForbiddenException('ULB context is required.');

    const ulbId      = new Types.ObjectId(user.ulb.toString());
    const designYear = new Types.ObjectId(dto.designYearId);

    const existing = await this.model
      .findOne({ ulb: ulbId, designYear })
      .select('formStatus')
      .lean()
      .exec();

    if (existing?.formStatus === 'SUBMITTED') {
      throw new ConflictException('Disclosure already submitted and cannot be overwritten.');
    }

    const payload = {
      ulb:         ulbId,
      designYear,
      mode:        dto.mode,
      fc14:        dto.fc14,
      fc15:        dto.fc15,
      formStatus:  'SUBMITTED',
      submittedBy: new Types.ObjectId(user._id),
      submittedAt: new Date(),
    };

    const doc = await this.model.findOneAndUpdate(
      { ulb: ulbId, designYear },
      { $set: payload },
      { upsert: true, new: true, runValidators: true },
    );
    return doc!;
  }

  async getByUlbAndYear(
    ulbId: Types.ObjectId | string,
    designYearId: string,
  ): Promise<XviFcUnspentBalanceDisclosureDocument | null> {
    const filter: FilterQuery<XviFcUnspentBalanceDisclosureDocument> = {
      ulb:        new Types.ObjectId(ulbId.toString()),
      designYear: new Types.ObjectId(designYearId),
    };
    return this.model.findOne(filter);
  }

  async update(
    id: string,
    dto: UpdateDisclosureDto,
    user: AuthUser,
  ): Promise<XviFcUnspentBalanceDisclosureDocument> {
    const disclosure = await this.model.findById(id, 'ulb formStatus');
    if (!disclosure) throw new NotFoundException('Disclosure not found.');
    if (disclosure.ulb.toString() !== user.ulb?.toString()) {
      throw new ForbiddenException('You are not authorised to update this disclosure.');
    }
    if (disclosure.formStatus === 'SUBMITTED') {
      throw new ForbiddenException('This disclosure has already been submitted and cannot be modified.');
    }

    const $set: Record<string, unknown> = {};
    if (dto.mode !== undefined) $set['mode'] = dto.mode;
    if (dto.fc14 !== undefined) $set['fc14'] = dto.fc14;
    if (dto.fc15 !== undefined) $set['fc15'] = dto.fc15;

    const update: UpdateQuery<XviFcUnspentBalanceDisclosureDocument> = { $set };
    const updated = await this.model.findByIdAndUpdate(id, update, { new: true, runValidators: true });
    if (!updated) throw new NotFoundException('Disclosure not found after update.');
    return updated;
  }

  async getDocumentSignedUrl(
    disclosureId: string,
    filepath: string,
    user: AuthUser,
  ): Promise<{ signedUrl: string }> {
    const disclosure = await this.model.findById(disclosureId, 'ulb fc14 fc15').lean().exec();
    if (!disclosure) throw new NotFoundException('Disclosure not found.');
    if (disclosure.ulb.toString() !== user.ulb?.toString()) {
      throw new ForbiddenException('You are not authorised to access this disclosure.');
    }

    const allPaths = [
      ...(disclosure.fc14?.documents ?? []),
      ...(disclosure.fc15?.documents ?? []),
    ].map((d) => d.filepath);

    if (!allPaths.includes(filepath)) {
      throw new ForbiddenException('The requested file does not belong to this disclosure.');
    }

    const signedUrl = await this.s3.presignGet(filepath);
    return { signedUrl };
  }
}
