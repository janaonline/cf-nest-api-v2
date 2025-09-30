import { Body, Controller, Get, HttpStatus, Logger, LoggerService, Post, Query, Res } from '@nestjs/common';
import express from 'express';
import { getHtmlFromTemplate, htmlUnsubscribeTemplate } from './constant';
import { EmailService } from './email.service';
import { UnsubscribePayload } from './interface';
import { ConfigService } from '@nestjs/config';

@Controller('email')
export class EmailController {
  private readonly logger = new Logger(EmailController.name);

  constructor(
    private readonly emailService: EmailService,
    private readonly configService: ConfigService,
  ) {}

  @Get('unsubscribe')
  unsubscribePage(@Query('token') token: string, @Res() res: express.Response) {
    if (!token) return res.status(HttpStatus.BAD_REQUEST).send(getHtmlFromTemplate('Missing token.'));

    // Show confirmation page with form
    // const htmlTemplate = htmlUnsubscribeTemplate(token);
    // return res.status(HttpStatus.OK).send(htmlTemplate);
    res.render('unsubscribe/unsubscribe', { token, baseUrl: this.configService.get('BASE_URL') as string });
  }
  @Get('unsubscribe/view')
  unsubscribeView(@Query('token') token: string, @Res() res: express.Response) {
    if (!token) return res.status(HttpStatus.BAD_REQUEST).send(getHtmlFromTemplate('Missing token.'));

    // Show confirmation page with form
    const htmlTemplate = htmlUnsubscribeTemplate(token);
    // return res.status(HttpStatus.OK).send(htmlTemplate);
    this.logger.log('Rendering unsubscribe view with token:', this.configService.get('BASE_URL'));
    res.render('unsubscribe/unsubscribe', { token, baseUrl: this.configService.get('BASE_URL') as string });
  }

  @Post('unsubscribe')
  async unsubscribeConfirm(@Body('token') token: string, @Res() res: express.Response) {
    if (!token) return res.status(HttpStatus.BAD_REQUEST).send(getHtmlFromTemplate('Missing token.'));

    const result = await this.emailService.handleUnsubscribe(token);
    if (!result.success)
      return res.status(HttpStatus.BAD_REQUEST).send(getHtmlFromTemplate(`Unsubscribe failed: ${result.error}`));

    return res.status(HttpStatus.OK).send(getHtmlFromTemplate(`${result.email} has been unsubscribed successfully.`));
  }

  @Get('token')
  getToken(@Query('email') email: string, @Query('desc') desc: string, @Res() res: express.Response) {
    if (!email) return res.status(HttpStatus.BAD_REQUEST).send({ success: false, message: 'Email is missing!' });

    const payload: UnsubscribePayload = { email, desc };
    const token = this.emailService.generateToken(payload);
    return res.status(HttpStatus.OK).send({ success: true, message: token });
  }
}
