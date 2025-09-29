import { Controller, Get, HttpStatus, Query, Res } from '@nestjs/common';
import express from 'express';
import { EmailService } from './email.service';
import { UnsubscribePayload } from './interface';

@Controller('email')
export class EmailController {
  constructor(private readonly emailService: EmailService) {}

  @Get('unsubscribe')
  async unsubscribe(@Query('token') token: string, @Res() res: express.Response) {
    if (!token) return res.status(HttpStatus.BAD_REQUEST).send('<h3>Missing token.</h3>');

    const result = await this.emailService.handleUnsubscribe(token);
    if (!result.success) return res.status(HttpStatus.BAD_REQUEST).send(`<h3>Unsubscribe failed: ${result.error}</h3>`);

    return res.status(HttpStatus.OK).send(`<h3>${result.email} has been unsubscribed successfully.</h3>`);
  }

  @Get('token')
  getToken(@Query('email') email: string, @Query('desc') desc: string, @Res() res: express.Response) {
    if (!email) return res.status(HttpStatus.BAD_REQUEST).send({ success: false, message: 'Email is missing!' });

    const payload: UnsubscribePayload = { email, desc };
    const token = this.emailService.generateToken(payload);
    return res.status(HttpStatus.OK).send({ success: true, message: token });
  }
}
