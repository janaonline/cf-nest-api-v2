// mailer.service.ts
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as fs from 'fs';
import * as handlebars from 'handlebars';
import * as path from 'path';

import { SESMailService } from 'src/core/aws-ses/ses.service';
import { EmailService } from 'src/core/email/email.service';
import { ULBData } from './zip.types';

@Injectable()
export class MailerService {
  private readonly logger = new Logger(MailerService.name);

  constructor(
    private readonly cfg: ConfigService,
    private emailService: EmailService,
    private sesV2: SESMailService,
  ) {}

  private compileTemplate(templateName: string, data: any): string {
    const filePath = path.join(__dirname, '..', '..', 'views', 'mail', `${templateName}.hbs`);
    // const filePath = join(__dirname, '..', '..', 'views', `${templateName}.hbs`);
    const source = fs.readFileSync(filePath, 'utf-8');
    const template = handlebars.compile(source);
    return template(data);
  }

  async sendDownloadLink(params: {
    name?: string;
    to: string;
    subject: string;
    link: string;
    key?: string;
    ulbData?: ULBData[];
    counts?: { total: number; skipped: number };
  }) {
    try {
      const name = params.name || params.to.split('@')[0];
      const token = this.emailService.generateToken({ email: params.to, desc: params.subject });
      const unsubscribeUrl = encodeURIComponent(`${this.cfg.get<string>('BASE_URL')}email/unsubscribe?token=${token}`);
      const ulbData = params.ulbData || [];
      if (ulbData.length === 0) {
        this.logger.warn('No ULB data provided for email');
        return;
      }
      const htmlBody = this.compileTemplate('resource-zip-ready', {
        name,
        download_link: params.link,
        unsubscribeUrl,
        state: ulbData[0]?.stateName || 'State',
        year: ulbData[0]?.year || 'Year',
        ulbs: ulbData?.map((u) => u.ulbName).join(', ') || '',
      });

      // console.log('Sending email to', params.to, 'from', this.from);
      //   const html1 = `
      //   <p>Your ZIP is ready.</p>
      //   <p><a href="${params.link}">Click to download</a> (expires soon)</p>
      //   <p>Key: ${params.key}<br/>Files: ${params.counts.total} (skipped: ${params.counts.skipped})</p>
      // `;
      // const result = await this.ses.send(
      //   new SendEmailCommand({
      //     Destination: { ToAddresses: [params.to] },
      //     Source: this.from,
      //     Message: {
      //       Subject: { Data: params.subject },
      //       Body: { Html: { Data: htmlBody } },
      //     },
      //   }),
      // );
      await this.sesV2.sendEmail({
        to: params.to,
        html: htmlBody,
        subject: 'Your City Finance Data is Ready to Download',
      });
      this.logger.log(`Email sent to ${params.to}`);
      // console.log('Email sent', result);
    } catch (error) {
      this.logger.error('Error sending email', error);
    }
  }
}
