import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { EmailList } from 'src/schemas/email-list';
import { EmailResInterface, UnsubscribePayload } from './interface';

@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);
  private secret: string;

  constructor(
    @InjectModel(EmailList.name)
    private readonly emailListModel: Model<EmailList>,
    // @InjectQueue('emailQueue') private readonly queue: Queue,
    private readonly configService: ConfigService,
    private readonly jwtService: JwtService,
  ) {
    this.secret = this.configService.get<string>('JWT_SECRET')!;
    if (!this.secret) throw new Error('JWT_SECRET is not defined in environment variables');
  }

  async handleUnsubscribe(token: string): Promise<{ success: boolean; email?: string; error?: string }> {
    const decoded: UnsubscribePayload | null = this.verifyToken(token);
    if (!decoded) return { success: false, error: 'Invalid or expired token.' };
    const { email } = decoded;
    try {
      // Add unsubscribed user to DB.
      const payload = {
        email,
        // source: desc,
        unsubscribedAt: new Date(),
        isUnsubscribed: true,
      };

      const dbRes = await this.emailListModel.findOneAndUpdate(
        { email },
        {
          $set: { ...payload },
          $setOnInsert: {
            isVerified: false,
            verifiedAt: null,
            attempt: 1,
          },
        },
        {
          upsert: true,
          new: true,
          setDefaultsOnInsert: true,
        },
      );
      this.logger.log({ dbRes });

      // TODO: Unsubscribe in ses Contact list.
      // await this.unsubscribeInSesContactList(email);

      this.logger.log(`Unsubscribed: ${email}`);
      return { success: true, email };
    } catch (error) {
      if (this.isDuplicateKeyError(error)) {
        this.logger.warn(
          JSON.stringify({
            msg: 'Email already unsubscribed (duplicate key)',
            email: email,
          }),
        );
        return { success: false, error: 'Email already unsubscribed (duplicate key).' };
      } else {
        this.logger.error(`Unsubscribe error for ${email}: ${error}`);
        return { success: false, error: 'Database error.' };
      }
    }
  }

  private readonly isDuplicateKeyError = (err: any): boolean => {
    // Mongo duplicate key error codes
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    return !!(err && typeof err === 'object' && (err.code === 11000 || err.code === 11001));
  };

  generateToken(payload: UnsubscribePayload): string {
    // return sign(payload, this.secret, { expiresIn: '7d' });
    return this.jwtService.sign(payload, { expiresIn: '7d' });
  }

  private verifyToken(token: string): UnsubscribePayload | null {
    try {
      // return verify(token, this.secret) as UnsubscribePayload;
      return this.jwtService.verify(token) as UnsubscribePayload;
    } catch (error) {
      this.logger.error('Failed to verify unsubscribe token:', error);
      return null;
    }
  }

  /**
   * If otp matches then mark isVerified to true.
   */
  async verifyEmail(email: string, otp: number): Promise<Partial<EmailResInterface>> {
    if (!email || !otp) return { success: false, message: 'Email or otp is missing!' };

    try {
      // TODO: check valid otp.
      if (otp !== 1234) return { success: false, message: 'Incorrect OTP!' };

      let user: EmailList | null = await this.emailListModel.findOne({ email }).lean();
      const insertObj = { isVerified: true, verifiedAt: new Date() };

      if (!user) {
        return {
          success: false,
          message: 'Email not found!',
        };
      }

      user = await this.emailListModel.findOneAndUpdate({ email }, { $set: insertObj }, { new: true });
      return {
        success: true,
        message: 'Email verified!',
        isVerified: user?.isVerified,
        isUnsubscribed: user?.isUnsubscribed,
      };
    } catch (error) {
      this.logger.error('Failed to validate email', error);
      return { success: false, message: 'Error validating email.' };
    }
  }
}
