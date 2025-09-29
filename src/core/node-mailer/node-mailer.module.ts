import { MailerModule } from '@nestjs-modules/mailer';
import { HandlebarsAdapter } from '@nestjs-modules/mailer/dist/adapters/handlebars.adapter';
import { Module } from '@nestjs/common';
import { join } from 'path';
import { NodeMailerController } from './node-mailer.controller';
import { NodeMailerService } from './node-mailer.service';

@Module({
  imports: [
    MailerModule.forRoot({
      transport: {
        host: process.env.MAIL_HOST, // smtp.mailtrap.io
        port: Number(process.env.MAIL_PORT), // 2525
        auth: {
          user: process.env.MAIL_USER,
          pass: process.env.MAIL_PASS,
        },
      },
      defaults: {
        from: '"NestJS App" <no-reply@example.com>',
      },
      template: {
        dir: join(__dirname, 'templates'), // folder for templates1
        // dir: join(__dirname, '/views/mail'), // folder for templates
        // dir: 'views/mail', // folder for templates
        adapter: new HandlebarsAdapter(), // using handlebars
        options: {
          strict: true,
        },
      },
    }),
  ],
  controllers: [NodeMailerController],
  providers: [NodeMailerService],
})
export class NodeMailerModule {}
