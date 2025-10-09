import { Controller, Get } from '@nestjs/common';
import { NodeMailerService } from './node-mailer.service';

@Controller('node-mailer')
export class NodeMailerController {
  constructor(private readonly nodeMailerService: NodeMailerService) {}

  @Get()
  async sendTestMail() {
    await this.nodeMailerService.sendWelcomeEmail('test@example.com', 'Jeeva');
    return { message: 'HTML Template Mail sent!' };
  }
}
