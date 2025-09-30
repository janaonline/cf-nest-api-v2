// mailer.service.ts
import { Injectable, Logger } from '@nestjs/common';
import { SESClient, SendEmailCommand } from '@aws-sdk/client-ses';
import { ConfigService } from '@nestjs/config';
import * as fs from 'fs';
import * as path from 'path';
import * as handlebars from 'handlebars';

import { renderFile } from 'hbs';
import { join } from 'path';

@Injectable()
export class MailerService {
  private ses: SESClient;
  private from: string;

  private readonly logger = new Logger(MailerService.name);

  constructor(cfg: ConfigService) {
    this.ses = new SESClient({
      region: cfg.get('AWS_REGION', 'ap-south-1'),
      credentials: {
        accessKeyId: cfg.get<string>('NEWSLETTER_AWS_ACCESS_KEY_ID')!,
        secretAccessKey: cfg.get<string>('NEWSLETTER_AWS_SECRET_ACCESS_KEY')!,
      },
    });
    this.from = cfg.get<string>('MAIL_FROM', 'no-reply@example.com');
  }

  private compileTemplate(templateName: string, data: any): string {
    const filePath = path.join(__dirname, '..', 'views', 'mail', `${templateName}.hbs`);
    // const filePath = join(__dirname, '..', '..', 'views', `${templateName}.hbs`);
    const source = fs.readFileSync(filePath, 'utf-8');
    const template = handlebars.compile(source);
    return template(data);
  }

  // private async renderTemplate(template: string, data: any): Promise<string> {
  //   const filePath = join(__dirname, '..', '..', 'views', `${template}.hbs`);
  //   return new Promise((resolve, reject) => {
  //     renderFile(filePath, data, (err, result) => {
  //       if (err) reject(err);
  //       else resolve(result);
  //     });
  //   });
  // }

  async sendDataReadyEmail(toEmail: string, name: string, downloadLink: string) {
    try {
      const htmlBody = this.compileTemplate('resource-zip-ready', {
        name,
        download_link: downloadLink,
      });

      // const htmlBody = 'test mail body';

      console.log('htmlBody', htmlBody);

      const command = new SendEmailCommand({
        // Source: 'no-reply@cityfinance.in', // must be verified in SES
        Source: this.from, // must be verified in SES
        Destination: { ToAddresses: [toEmail] },
        Message: {
          Subject: { Data: 'Your City Finance Data is Ready to Download' },
          Body: {
            Html: { Data: htmlBody },
            Text: {
              Data: `Hello ${name},\n\nYour City Finance data is ready. Link: ${downloadLink}\n(Expires in 30 days)\n\nRegards,\nTeam City Finance`,
            },
          },
        },
      });
      console.log('command', command);
      this.logger.log(`Sending data ready email to ${toEmail}`);
      const res = await this.ses.send(command);
      // return await this.ses.send(command);
      console.log('res', res);
      return res;
    } catch (error) {
      this.logger.error('Error sending data ready email', error);
    }
  }

  async sendDownloadLink(params: {
    to: string;
    subject: string;
    link: string;
    key: string;
    counts: { total: number; skipped: number };
  }) {
    const name = params.to.split('@')[0];
    try {
      // console.log('Sending email to', params.to, 'from', this.from);
      const html1 = `
      <p>Your ZIP is ready.</p>
      <p><a href="${params.link}">Click to download</a> (expires soon)</p>
      <p>Key: ${params.key}<br/>Files: ${params.counts.total} (skipped: ${params.counts.skipped})</p>
    `;
      const html = `
    <html lang="en">
  <body>
    <h2>Your City Finance Data is Ready to Download</h2>

    <p>Hello <strong>${name}</strong>,</p>

    <p>
      The City Finance data you requested is now ready for download.  
      The link will expire in <strong>30 days</strong>.
    </p>

    <p>
      <a href="${params.link}">Click here to Download</a>
    </p>

    <p><strong>Export Details:</strong></p>
    <ul>
      <li>Data submitted by ULBs in PDF</li>
      <li>Karnataka files – Bangalore, Mysuru, Davangere</li>
      <li>2021-22 to 2023-24</li>
    </ul>

    <p>
      <strong>Usage:</strong> This data is open for everyone to use without restriction.  
      However, if you use this data, we request that you acknowledge/cite  
      <em>City Finance</em> as the source.
    </p>

    <p>
      Have questions about the data? Reply to this email to get in touch.
    </p>

    <p>Regards,<br/>Team City Finance</p>

    <hr />
    <p>
      You received this email because you requested data on City Finance.  
      If you did not make this request, you can ignore this message.
    </p>
  </body>
</html>
    `;
      const result = await this.ses.send(
        new SendEmailCommand({
          Destination: { ToAddresses: [params.to] },
          Source: this.from,
          Message: {
            Subject: { Data: params.subject },
            Body: { Html: { Data: html } },
          },
        }),
      );
      // console.log('Email sent', result);
    } catch (error) {
      this.logger.error('Error sending email', error);
    }
  }
}
