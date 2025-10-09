import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { EmailList, EmailListSchema } from 'src/schemas/email-list';
import { EmailController } from './email.controller';
import { EmailService } from './email.service';
import { EmailQueueModule } from '../queue/email-queue/email-queue.module';
import { RateLimitService } from '../services/rate-limit/rate-limit.service';
import { RedisService } from '../services/redis/redis.service';
import { AuthModule } from 'src/module/auth/auth.module';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: EmailList.name, schema: EmailListSchema }]),
    EmailQueueModule,
    AuthModule,
    // JwtModule.registerAsync({
    //   imports: [ConfigModule],
    //   inject: [ConfigService],
    //   useFactory: (config: ConfigService) => ({
    //     secret: config.get<string>('JWT_SECRET'),
    //     signOptions: { expiresIn: '1d' }, // 1 day expiry
    //   }),
    // }),
  ],
  controllers: [EmailController],
  providers: [EmailService, RateLimitService, RedisService],
  exports: [EmailService],
})
export class EmailModule {}
