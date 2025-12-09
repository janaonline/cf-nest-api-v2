import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { EmailList } from 'src/schemas/email-list';
import { EmailQueueService } from '../queue/email-queue/email-queue.service';
import { RateLimitService } from '../services/rate-limit/rate-limit.service';
import { RedisService } from '../services/redis/redis.service';
import { SendOtpDto, VerifyOtpDto } from './dto/otp.dto';
import { UnsubscribePayload } from './interface';

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
    private readonly rateLimit: RateLimitService,
    private readonly redis: RedisService,
    private readonly mailQueue: EmailQueueService,
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
   * - Check if email exists in EmailList collection?
   *    - Yes: Check if email is verified.
   *        - if Yes: send isEmailVerified true (do not send OTP).
   *        - if No: Send OTP.
   *    - No: Add email to EmailList collection and send OTP.
   */
  async sendOtp(body: SendOtpDto) {
    try {
      const { email } = body;

      // 🔒 Rate limit sending attempts
      await this.rateLimit.checkLimit(`otp:${email}:send`);

      try {
        // Check email in EmailLists collection.
        const user = await this.emailListModel.findOne({ email });

        // If user not found add in collection.
        if (!user) {
          const insertedUser = await this.emailListModel.insertOne({ email });
          if (!insertedUser) {
            const response = this.createResponseStructure('Failed to insert email id!');
            throw new BadRequestException(response);
          }
          return await this._sendOtp(email);
        }

        // If user is already verfied.
        if (user.isVerified) {
          return this.createResponseStructure(
            'Email ID verifed successfully!',
            false,
            false,
            true,
            user.isUnsubscribed,
          );
        } else {
          return await this._sendOtp(email);
        }
      } catch (error) {
        this.logger.error('Failed to send OTP!' + error);
      }
    } catch (error) {
      this.logger.error(error);
      throw error;
    }
  }

  // Send OTP.
  async _sendOtp(email: string) {
    const otp = Math.floor(100000 + Math.random() * 900000).toString();

    // Set OTP to cache.
    await this.redis.set(`otp:${email}`, otp, 300); // 5 min TTL
    const html = `<p>Your OTP is <b>${otp}</b>. It is valid for 5 minutes.</p>`;
    await this.mailQueue.addEmailJob({
      to: email,
      subject: 'CityFinance - Your OTP Code',
      templateName: 'otp',
      mailData: { otp },
    });

    this.logger.log(`Sent OTP ${otp} to ${email}`);
    return this.createResponseStructure('OTP sent successfully', true);
  }

  /**
   * - Check if email exists in EmailList collection?
   *    - Yes: Check if OTP Matches.
   *        - if Yes: mark the user as verified.
   *        - if No: throw error.
   *    - No: throw error.
   */
  async verifyOtp(body: VerifyOtpDto) {
    const { email, otp } = body;

    // 🔒 Rate limit verification attempts
    await this.rateLimit.checkLimit(`otp:${email}:verify`);

    // Check email in EmailLists collection.
    const user = await this.emailListModel.findOne({ email });

    // If user not found throw error.
    if (!user) {
      const response = this.createResponseStructure('Email id does not exists!');
      throw new BadRequestException(response);
    }

    // Get the OTP from cache.
    const stored = await this.redis.get(`otp:${email}`);

    if (!stored) {
      const response = this.createResponseStructure('OTP expired');
      throw new BadRequestException(response);
    }

    if (stored !== otp) {
      const response = this.createResponseStructure('Invalid OTP');
      throw new BadRequestException(response);
    } else {
      // Remove from cache: if verified.
      await this.redis.del(`otp:${email}`);

      // Mark isVerified to true.
      await this.emailListModel.updateOne({ email }, { $set: { isVerified: true, verifiedAt: new Date() } });
      const updatedUser = await this.emailListModel.findOne({ email });

      if (!updatedUser) {
        const response = this.createResponseStructure('Failed to verify email id!');
        throw new BadRequestException(response);
      } else {
        return this.createResponseStructure(
          'OTP verified!',
          false,
          true,
          updatedUser.isVerified,
          updatedUser.isUnsubscribed,
        );
      }
    }
  }

  // Create uniform response strucute
  private createResponseStructure(
    message: string,
    isOtpSent: boolean = false,
    isOtpVerified: boolean = false,
    isEmailVerified: boolean = false,
    isUnsubscribed: boolean = false,
  ) {
    return {
      isOtpSent,
      isOtpVerified,
      isEmailVerified,
      isUnsubscribed,
      message,
    };
  }
}
