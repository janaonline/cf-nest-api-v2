import { SESv2Client, SendEmailCommand } from '@aws-sdk/client-sesv2';
import { Injectable } from '@nestjs/common';
import * as fs from 'fs';
import * as handlebars from 'handlebars';
import * as path from 'path';

@Injectable()
export class SESMailService {
  private ses = new SESv2Client({
    region: 'ap-south-1',
    credentials: {
      accessKeyId: process.env.SES_AWS_ACCESS_KEY_ID!,
      secretAccessKey: process.env.SES_AWS_SECRET_ACCESS_KEY!,
    },
  });

  private compileTemplate(templateName: string, data: any): string {
    const filePath = path.join(__dirname, '..', '..', 'views/mail', `${templateName}.hbs`);
    const source = fs.readFileSync(filePath, 'utf-8');
    return handlebars.compile(source)(data);
  }

  //   async sendEmail(to: string, name: string, link: string) {
  async sendEmail(params: { from?: string; to: string; html: string; text?: string; subject: string }) {
    const cmd = new SendEmailCommand({
      FromEmailAddress: params.from || 'updates@cityfinance.in',
      Destination: { ToAddresses: [params.to] },
      Content: {
        Simple: {
          Subject: { Data: params.subject },
          Body: {
            Html: { Data: params.html },
            // Text: { Data: texts || 'Your City Finance Data is Ready' },
          },
        },
      },
    });

    // const cmd = new SendEmailCommand({
    //   Destination: { ToAddresses: [params.to] },
    //   FromEmailAddress: params.from,
    //   Message: {
    //     Subject: { Data: params.subject },
    //     Body: { Html: { Data: params.htmlBody } },
    //   },
    // });

    return this.ses.send(cmd);
  }
}
