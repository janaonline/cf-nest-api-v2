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
