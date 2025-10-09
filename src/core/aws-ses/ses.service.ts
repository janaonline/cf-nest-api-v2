import { SESv2Client, SendEmailCommand } from '@aws-sdk/client-sesv2';
import { Injectable, Logger } from '@nestjs/common';
import * as fs from 'fs';
import * as handlebars from 'handlebars';
import * as path from 'path';
import { EmailJob } from './email-job.type';

@Injectable()
export class SESMailService {
  logger = new Logger(SESMailService.name);
  private ses = new SESv2Client({
    region: process.env.AWS_REGION,
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

  // private compileTemplate(templateName: string, data: any): string {
  //     const filePath = path.join(__dirname, '..', '..', '..', 'views', 'mail', `${templateName}.hbs`);
  //     // const filePath = join(__dirname, '..', '..', 'views', `${templateName}.hbs`);
  //     const source = fs.readFileSync(filePath, 'utf-8');
  //     const template = handlebars.compile(source);
  //     return template(data);
  //   }

  //   async sendEmail(to: string, name: string, link: string) {
  async sendEmail(params: EmailJob) {
    try {
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
      this.logger.log(`Sending email to ${params.to}`);
      return this.ses.send(cmd);
    } catch (error) {
      this.logger.error('Error sending email:', error);
      throw error;
    }
  }

  async sendEmailTemplate(params: EmailJob) {
    try {
      const htmlTemplate = this.compileTemplate('resource-zip-ready', params.mailData);
      const cmd = new SendEmailCommand({
        FromEmailAddress: params.from || 'updates@cityfinance.in',
        Destination: { ToAddresses: [params.to] },
        Content: {
          Simple: {
            Subject: { Data: params.subject },
            Body: {
              Html: { Data: htmlTemplate },
              // Text: { Data: texts || 'Your City Finance Data is Ready' },
            },
          },
        },
      });
      this.logger.log(`Sending email to ${params.to}`);
      return this.ses.send(cmd);
    } catch (error) {
      this.logger.error('Error sending email:', error);
      throw error;
    }
  }
}
