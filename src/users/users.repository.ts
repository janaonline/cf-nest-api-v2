import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { User, UserDocument } from 'src/schemas/user/user.schema';

@Injectable()
export class UsersRepository {
  constructor(@InjectModel(User.name) private readonly userModel: Model<UserDocument>) { }

  async findById(id: string): Promise<UserDocument | null> {
    return this.userModel.findById(id).exec();
  }

  async findByEmail(email: string): Promise<UserDocument | null> {
    return this.userModel.findOne({ email: email.toLowerCase() }).exec();
  }

  async findByEmailWithSensitiveFields(email: string): Promise<UserDocument | null> {
    return this.userModel
      .findOne({ email: email.toLowerCase() })
      .select('+password +refreshTokenHash +otpHash +loginAttempts +lockUntil +isLocked')
      .exec();
  }

  async findByIdentifierWithSensitiveFields(identifier: string): Promise<UserDocument | null> {
    const isEmail = identifier.includes('@');
    const query = isEmail
      ? { email: identifier }
      : { $or: [{ censusCode: identifier }, { sbCode: identifier }] };
    return this.userModel
      .findOne({ ...query, isDeleted: false, isActive: true })
      .select('+password +loginAttempts +lockUntil +isLocked')
      .exec();
  }

  async incrementLoginAttempts(id: string): Promise<void> {
    const MAX_ATTEMPTS = 5;
    const LOCK_DURATION_MS = 60 * 60 * 1000;
    const user = await this.userModel
      .findByIdAndUpdate(id, { $inc: { loginAttempts: 1 } }, { new: true })
      .select('+loginAttempts')
      .exec();
    if (user && user.loginAttempts >= MAX_ATTEMPTS) {
      await this.userModel
        .findByIdAndUpdate(id, { isLocked: true, lockUntil: Date.now() + LOCK_DURATION_MS })
        .exec();
    }
  }

  async resetLoginAttempts(id: string): Promise<void> {
    await this.userModel
      .findByIdAndUpdate(id, { loginAttempts: 0, isLocked: false, lockUntil: null })
      .exec();
  }

  async findByIdWithRefreshToken(id: string): Promise<UserDocument | null> {
    return this.userModel.findById(id).select('+refreshTokenHash').exec();
  }

  async create(data: Partial<User>): Promise<UserDocument> {
    const user = new this.userModel(data);
    return user.save();
  }

  async updateRefreshToken(id: string, hash: string | null): Promise<void> {
    await this.userModel.findByIdAndUpdate(id, { refreshTokenHash: hash }).exec();
  }

  async updateOtp(
    id: string,
    otpData: { hash: string; expiresAt: Date; attempts: number },
  ): Promise<void> {
    await this.userModel
      .findByIdAndUpdate(id, {
        otpHash: otpData.hash,
        otpExpiresAt: otpData.expiresAt,
        otpAttempts: otpData.attempts,
      })
      .exec();
  }

  async incrementOtpAttempts(id: string): Promise<void> {
    await this.userModel.findByIdAndUpdate(id, { $inc: { otpAttempts: 1 } }).exec();
  }

  async clearOtp(id: string): Promise<void> {
    await this.userModel
      .findByIdAndUpdate(id, { otpHash: null, otpExpiresAt: null, otpAttempts: 0 })
      .exec();
  }

  async updateLastLogin(id: string): Promise<void> {
    await this.userModel.findByIdAndUpdate(id, { lastLoginAt: new Date() }).exec();
  }

  async exists(email: string): Promise<boolean> {
    const count = await this.userModel.countDocuments({ email: email.toLowerCase() }).exec();
    return count > 0;
  }
}
