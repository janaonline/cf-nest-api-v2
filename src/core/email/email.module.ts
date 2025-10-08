import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { EmailList, EmailListSchema } from 'src/schemas/email-list';
import { EmailController } from './email.controller';
import { EmailService } from './email.service';
import { EmailQueueModule } from '../queue/email-queue/email-queue.module';
import { RateLimitService } from '../services/rate-limit/rate-limit.service';
import { RedisService } from '../services/redis/redis.service';

@Module({
  imports: [MongooseModule.forFeature([{ name: EmailList.name, schema: EmailListSchema }]), EmailQueueModule],
  controllers: [EmailController],
  providers: [EmailService, RateLimitService, RedisService],
  exports: [EmailService],
})
export class EmailModule {}
