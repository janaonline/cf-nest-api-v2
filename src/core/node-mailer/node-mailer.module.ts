import { MailerModule } from '@nestjs-modules/mailer';
import { HandlebarsAdapter } from '@nestjs-modules/mailer/dist/adapters/handlebars.adapter';
import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { join } from 'path';
import { EMAIL_QUEUE } from '../queue/email-queue/email-queue.constant';
import { NodeMailerController } from './node-mailer.controller';
import { NodeMailerService } from './node-mailer.service';

@Module({
  imports: [
    BullModule.registerQueue({
      name: EMAIL_QUEUE,
      defaultJobOptions: {
        removeOnComplete: { age: 86400, count: 2000 }, // keep for a day or 2k jobs
        removeOnFail: 1000,
        attempts: 1,
      },
    }),
    MailerModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        transport: {
          host: config.get<string>('MAIL_HOST'),
          port: config.get<number>('MAIL_PORT'),
          secure: false, // true for port 465, false for 587/2525
          auth: {
            user: config.get<string>('MAIL_USER'),
            pass: config.get<string>('MAIL_PASS'),
          },
          tls: {
            minVersion: 'TLSv1.2',
            // ciphers: 'SSLv3',
            // rejectUnauthorized: false, // TODO: 👈 TEMP fix for "self-signed certificate in certificate chain"
          },
        },
        defaults: {
          from: config.get<string>('MAIL_FROM'),
        },
        template: {
          dir: join(__dirname, '..', '..', 'views/mail'),
          adapter: new HandlebarsAdapter(),
          options: { strict: true },
        },
      }),
    }),
  ],
  exports: [NodeMailerService],
  controllers: [NodeMailerController],
  providers: [NodeMailerService],
})
export class NodeMailerModule {}
