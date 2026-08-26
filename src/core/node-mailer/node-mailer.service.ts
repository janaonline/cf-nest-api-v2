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

  async sendEmailWithTemplate(
    to: string | string[],
    subject: string,
    templateName: string,
    mailData?: Record<string, any>,
  ) {
    try {
      this.logger.log(`Sending email to: ${Array.isArray(to) ? to.join(', ') : to}`);
      await this.mailerService.sendMail({
        to,
        subject,
        template: templateName,
        context: mailData,
      });
      this.logger.log(`Email sent successfully to: ${to}`);
    } catch (error) {
      this.logger.error(`Failed to send email to ${to} (template: ${templateName}):`, error);
      throw error;
    }
  }

  async sendHtml(to: string | string[], subject: string, html: string): Promise<void> {
    try {
      this.logger.log(`Sending HTML email to: ${Array.isArray(to) ? to.join(', ') : to}`);
      await this.mailerService.sendMail({ to, subject, html });
    } catch (error) {
      this.logger.error('Error sending HTML email:', error);
      throw error;
    }
  }
}
