import { MailerService } from '@nestjs-modules/mailer';
import { Injectable } from '@nestjs/common';

@Injectable()
export class NodeMailerService {
  constructor(private readonly mailerService: MailerService) {}

  async sendWelcomeEmail(to: string, name: string) {
    await this.mailerService.sendMail({
      to,
      subject: 'Welcome to NestJS + Mailtrap',
      template: './welcome', // matches templates/welcome.hbs
      context: {
        // variables for template
        name,
      },
    });
  }
}
