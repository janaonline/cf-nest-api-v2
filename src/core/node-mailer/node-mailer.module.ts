import { MailerModule } from '@nestjs-modules/mailer';
import { HandlebarsAdapter } from '@nestjs-modules/mailer/dist/adapters/handlebars.adapter';
import { Module } from '@nestjs/common';
import { join } from 'path';
import { NodeMailerController } from './node-mailer.controller';
import { NodeMailerService } from './node-mailer.service';
import { SendEmailCommand, SESv2Client } from '@aws-sdk/client-sesv2';
import { SendRawEmailCommand } from '@aws-sdk/client-ses';

const sesV2 = new SESv2Client({
  region: 'ap-south-1',
  credentials: {
    accessKeyId: process.env.SES_AWS_ACCESS_KEY_ID!,
    secretAccessKey: process.env.SES_AWS_SECRET_ACCESS_KEY!,
  },
});

const sesv2Adapter = {
  config: { region: 'ap-south-1' },
  sendRawEmail(params: {
    RawMessage: { Data: Buffer | Uint8Array | string };
    Source?: string;
    Destinations?: string[];
  }) {
    const command = new SendEmailCommand({
      FromEmailAddress: params.Source,
      Destination: params.Destinations ? { ToAddresses: params.Destinations } : undefined,
      Content: { Raw: { Data: params.RawMessage.Data as any } },
    });
    return {
      promise: async () => {
        const res = await sesV2.send(command);
        return { MessageId: res.MessageId };
      },
    };
  },
};

@Module({
  imports: [
    MailerModule.forRoot({
      transport: { SES: sesv2Adapter as any },
      // transport: {
      //   SES: { ses },

      //   // SES: {
      //   //   ses: new SESv2Client({
      //   //     region: 'ap-south-1',
      //   //     credentials: {
      //   //       accessKeyId: process.env.SES_AWS_ACCESS_KEY_ID!,
      //   //       secretAccessKey: process.env.SES_AWS_SECRET_ACCESS_KEY!,
      //   //     },
      //   //   }),
      //   // },
      //   // host: process.env.MAIL_HOST, // smtp.mailtrap.io
      //   // port: Number(process.env.MAIL_PORT), // 2525
      //   // auth: {
      //   //   user: process.env.MAIL_USER,
      //   //   pass: process.env.MAIL_PASS,
      //   // },
      // },
      defaults: {
        // from: '"NestJS App" <no-reply@example.com>
        from: '"City Finance" <updates@cityfinance.in>',
      },
      template: {
        // dir: join(__dirname, 'templates'), // folder for templates1
        dir: join(__dirname, '..', '..', 'views/mail'), // folder for templates
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
