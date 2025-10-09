import { Body, Controller, Get, HttpStatus, Logger, Post, Query, Res } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiBody, ApiOperation, ApiResponse } from '@nestjs/swagger';
import express from 'express';
import { EmailQueueService } from '../queue/email-queue/email-queue.service';
import { RateLimitService } from '../services/rate-limit/rate-limit.service';
import { RedisService } from '../services/redis/redis.service';
import { getHtmlFromTemplate, htmlUnsubscribeTemplate } from './constant';
import { SendOtpDto, VerifyOtpDto } from './dto/otp.dto';
import { EmailService } from './email.service';
import { UnsubscribePayload } from './interface';

@Controller('email')
export class EmailController {
  private readonly logger = new Logger(EmailController.name);

  constructor(
    private readonly emailService: EmailService,
    private readonly configService: ConfigService,
    private readonly rateLimit: RateLimitService,
    private readonly redis: RedisService,
    private readonly mailQueue: EmailQueueService,
    // @InjectQueue('emailQueue') private readonly queue: Queue,
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

  @Post('sendOtp')
  @ApiOperation({ summary: 'Send OTP to email' })
  @ApiResponse({ status: 200, description: 'OTP sent successfully' })
  @ApiResponse({ status: 429, description: 'Rate limit exceeded' })
  @ApiBody({ type: SendOtpDto })
  async sendOtp(@Body() body: SendOtpDto) {
    return await this.emailService.sendOtp(body);
  }

  @Post('verifyOtp')
  @ApiOperation({ summary: 'Verify OTP' })
  @ApiResponse({ status: 200, description: 'OTP verified successfully' })
  @ApiResponse({ status: 400, description: 'Invalid or expired OTP' })
  @ApiBody({ type: VerifyOtpDto })
  async verifyOtp(@Body() body: VerifyOtpDto) {
    return await this.emailService.verifyOtp(body);
  }

  // @Post('verify')
  // async verifyOtp(@Body() body: { email: string; otp: string }) {
  //   const { email, otp } = body;
  //   const stored = await this.redis.get(`otp:${email}`);
  //   if (!stored) throw new BadRequestException('OTP expired');
  //   if (stored !== otp) throw new BadRequestException('Invalid OTP');

  //   await this.redis.del(`otp:${email}`);
  //   return { message: 'OTP verified successfully' };
  // }

  // @Get('verify')
  // async verifyEmail(@Query('email') email: string, @Query('otp') otp: number, @Res() res: express.Response) {
  //   const validatedObj = await this.emailService.verifyEmail(email, otp);
  //   const statusCode = validatedObj.success ? HttpStatus.OK : HttpStatus.BAD_REQUEST;
  //   return res.status(statusCode).send(validatedObj);
  // }
}
