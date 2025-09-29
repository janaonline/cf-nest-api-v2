import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { sign, verify } from 'jsonwebtoken';
import { Model } from 'mongoose';
import { UnsubscribedUser } from 'src/schemas/unsubscribed-users';
import { UnsubscribePayload } from './interface';

@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);
  private secret: string | undefined;

  constructor(
    @InjectModel(UnsubscribedUser.name)
    private readonly unsubscribeduserModel: Model<UnsubscribedUser>,

    private readonly configService: ConfigService,
  ) {
    this.secret = this.configService.get<string>('UNSUBSCRIBE_SECRET');
    if (!this.secret) throw new Error('UNSUBSCRIBE_SECRET is not defined in environment variables');
  }

  async handleUnsubscribe(token: string): Promise<{ success: boolean; email?: string; error?: string }> {
    const decoded: UnsubscribePayload | null = this.verifyToken(token);
    if (!decoded) return { success: false, error: 'Invalid or expired token.' };
    const { email, desc } = decoded;
    try {
      // Add unsubscribed user to DB.
      const payload = {
        email,
        source: desc,
        unsubscribedAt: new Date(),
      };
      await this.unsubscribeduserModel.insertOne(payload);

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
    if (!payload.email) throw new Error('Email is required to generate unsubscribe token');
    if (!this.secret) throw new Error('UNSUBSCRIBE_SECRET is not defined in environment variables');

    return sign(payload, this.secret, { expiresIn: '7d' });
  }

  private verifyToken(token: string): UnsubscribePayload | null {
    try {
      if (!this.secret) throw new Error('UNSUBSCRIBE_SECRET is not defined in environment variables');
      return verify(token, this.secret) as UnsubscribePayload;
    } catch (err) {
      console.error('Failed to verify unsubscribe token:', err);
      return null;
    }
  }
}
