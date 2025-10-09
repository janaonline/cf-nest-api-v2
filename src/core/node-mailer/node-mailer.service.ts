import { MailerService } from '@nestjs-modules/mailer';
import { Injectable, Logger } from '@nestjs/common';

@Injectable()
export class NodeMailerService {
  logger = new Logger(NodeMailerService.name);
  constructor(private readonly mailerService: MailerService) {}

  async sendWelcomeEmail(to: string, name: string) {
    try {
      this.logger.log('Sending email to:', to, 'with name:', name);

      await this.sendEmailWithTemplate(to, 'Welcome to NestJS + Mailtrap', './welcome', { name });
      // await this.mailerService.sendMail({
      //   to,
      //   subject: 'Welcome to NestJS + Mailtrap',
      //   template: './welcome', // matches templates/welcome.hbs
      //   context: {
      //     // variables for template
      //     name,
      //   },
      // });
    } catch (error) {
      this.logger.error('Error sending email:', error);
    }
  }

  async sendEmailWithTemplate(to: string, subject: string, templateName: string, mailData?: Record<string, any>) {
    try {
      this.logger.log('Sending email to:', to);
      await this.mailerService.sendMail({
        to,
        subject,
        template: templateName, //'./welcome', // matches templates/welcome.hbs
        context: mailData,
      });
    } catch (error) {
      this.logger.error('Error sending email:', error);
    }
  }
}
