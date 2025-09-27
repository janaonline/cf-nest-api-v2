// mailer.service.ts
import { Injectable } from '@nestjs/common';
import { SESClient, SendEmailCommand } from '@aws-sdk/client-ses';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class MailerService {
  private ses: SESClient;
  private from: string;

  constructor(cfg: ConfigService) {
    this.ses = new SESClient({ region: cfg.get('AWS_REGION', 'ap-south-1') });
    this.from = cfg.get<string>('MAIL_FROM', 'no-reply@example.com');
  }

  async sendDownloadLink(params: {
    to: string;
    subject: string;
    link: string;
    key: string;
    counts: { total: number; skipped: number };
  }) {
    const html = `
      <p>Your ZIP is ready.</p>
      <p><a href="${params.link}">Click to download</a> (expires soon)</p>
      <p>Key: ${params.key}<br/>Files: ${params.counts.total} (skipped: ${params.counts.skipped})</p>
    `;
    await this.ses.send(
      new SendEmailCommand({
        Destination: { ToAddresses: [params.to] },
        Source: this.from,
        Message: {
          Subject: { Data: params.subject },
          Body: { Html: { Data: html } },
        },
      }),
    );
  }
}
