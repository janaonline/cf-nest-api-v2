import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Logger,
  Param,
  Patch,
  Post,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import { AuthService } from './auth.service';
import { LoginService } from './login.service';
import { OtpService } from './otp.service';
import { VisitSessionService } from './visit-session.service';
import { CurrentUser } from './decorators/current-user.decorator';
import { Public } from './decorators/public.decorator';
import { CheckUserDto } from './dto/check-user.dto';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { SetNewPasswordDto } from './dto/set-new-password.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { SendOtpDto } from './dto/send-otp.dto';
import { VerifyOtpDto } from './dto/verify-otp.dto';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { JwtRefreshGuard } from './guards/jwt-refresh.guard';
import type { User } from 'src/module/auth/enum/role.enum';
import { PermissionGuard } from './permission.guard';
import { RequirePermissions } from './require-permissions.decorator';
import { Permission } from './enum/roles-xvi-fc.enum';
@ApiTags('auth')
@Controller('auth')
export class AuthController {
  logger = new Logger(AuthController.name);
  constructor(
    private readonly authService: AuthService,
    private readonly loginService: LoginService,
    private readonly otpService: OtpService,
    private readonly visitSessionService: VisitSessionService,
  ) {}

  @Public()
  @Post('check-user')
  // @UseGuards(JwtAuthGuard, PermissionGuard)
  // @RequirePermissions(Permission.VIEW_STATUS_REPORTS)
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @ApiOperation({ summary: 'Check if a user exists and determine login flow' })
  @ApiResponse({ status: 200, description: 'User found — returns status, isXVIFCProfileVerified, maskedContact' })
  @ApiResponse({ status: 404, description: 'User not found' })
  checkUser(@Body() dto: CheckUserDto) {
    return this.loginService.checkUser(dto);
  }

  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @ApiOperation({ summary: 'Login with email and password' })
  @ApiResponse({ status: 200, description: 'Returns access token and user' })
  @ApiResponse({ status: 401, description: 'Invalid credentials' })
  login(@Body() dto: LoginDto, @Res({ passthrough: true }) res: Response) {
    return this.loginService.login(dto, res);
  }

  @UseGuards(JwtAuthGuard)
  @Get('me')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get current authenticated user details' })
  @ApiResponse({ status: 200, description: 'Returns current user details' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async getMe(@CurrentUser() user: User) {
    // return this.authService.getUserById(user._id);
    const isEligibleForXviFc = await this.loginService.resolveXviFcEligibility(user);
    return { user, isEligibleForXviFc };
  }

  @UseGuards(JwtAuthGuard)
  @Post('logout')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Logout and clear refresh token cookie' })
  @ApiResponse({ status: 200, description: 'Logged out successfully' })
  logout(
    @CurrentUser() user: { _id: string; sessionId?: string; exp?: number },
    @Res({ passthrough: true }) res: Response,
  ) {
    return this.authService.logout(user._id, res, user.sessionId, user.exp);
  }

  @Public()
  @UseGuards(JwtRefreshGuard)
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Rotate access token using refresh token cookie' })
  @ApiResponse({ status: 200, description: 'Returns new access token' })
  @ApiResponse({ status: 440, description: 'Session expired' })
  refresh(@CurrentUser() user: { _id: string; refreshToken: string }, @Res({ passthrough: true }) res: Response) {
    return this.authService.refreshTokens(user._id, user.refreshToken, res);
  }

  // TODO: to be removed
  // @Public()
  // @Post('register')
  // @HttpCode(HttpStatus.CREATED)
  // @Throttle({ default: { limit: 5, ttl: 60000 } })
  // @ApiOperation({ summary: 'Register a new user account' })
  // @ApiResponse({ status: 201, description: 'User registered successfully' })
  // @ApiResponse({ status: 409, description: 'Email already registered' })
  // register(@Body() dto: RegisterDto) {
  //   return this.authService.register(dto);
  // }

  @Public()
  @Post('captcha_validate')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Validate a reCAPTCHA token' })
  @ApiResponse({ status: 200, description: 'Captcha result' })
  validateCaptcha(@Body('recaptcha') token: string) {
    return this.authService.validateCaptcha(token);
  }

  @Public()
  @Post('sendOtp')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 3, ttl: 600000 } })
  @ApiOperation({ summary: 'Send OTP via SMS and email (accepts email, census code, or SB code or mobile number)' })
  @ApiResponse({ status: 200, description: 'OTP sent — returns masked mobile and email' })
  sendOtp(@Body() dto: SendOtpDto) {
    return this.otpService.sendOtp(dto);
  }

  @Public()
  @Post('verifyOtp')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Verify OTP and receive access token' })
  @ApiResponse({ status: 200, description: 'Returns access token and user' })
  @ApiResponse({ status: 422, description: 'Invalid or expired OTP' })
  verifyOtp(@Body() dto: VerifyOtpDto, @Res({ passthrough: true }) res: Response) {
    return this.otpService.verifyOtp(dto, res);
  }

  @Public()
  @Post('verifyMobileOtp')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @ApiOperation({ summary: 'Verify a mobile-verify OTP without issuing auth tokens' })
  @ApiResponse({ status: 200, description: 'OTP verified — returns { success: true }' })
  @ApiResponse({ status: 422, description: 'Invalid or expired OTP' })
  @ApiResponse({ status: 429, description: 'Too many attempts' })
  verifyMobileOtp(@Body() dto: VerifyOtpDto) {
    return this.otpService.verifyMobileOtp(dto);
  }

  @Patch('set-new-password')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @ApiOperation({ summary: 'Set a new permanent password (called during first-login onboarding flow)' })
  @ApiResponse({ status: 200, description: 'Password updated successfully' })
  setNewPassword(@CurrentUser() user: { _id: string }, @Body() dto: SetNewPasswordDto) {
    return this.authService.setNewPassword(user._id, dto.newPassword, dto.saveToken, {
      name: dto.name,
      mobile: dto.mobile,
      designation: dto.designation,
    });
  }

  @Public()
  @Post('forgot-password/reset')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @ApiOperation({ summary: 'Verify OTP and reset password in one step' })
  @ApiResponse({ status: 200, description: 'Password updated successfully' })
  @ApiResponse({ status: 422, description: 'Invalid or expired OTP' })
  @ApiResponse({ status: 429, description: 'Too many attempts' })
  forgotPasswordReset(@Body() dto: ResetPasswordDto) {
    return this.otpService.forgotPasswordReset(dto);
  }

  @Public()
  @Get('start_session')
  @ApiOperation({ summary: 'Create a new visit session' })
  @ApiResponse({ status: 200, description: 'Returns the new session _id' })
  startSession() {
    return this.visitSessionService.startSession();
  }

  @Public()
  @Get('end_session/:id')
  @ApiOperation({ summary: 'Mark a visit session as inactive' })
  @ApiResponse({ status: 200, description: 'Session ended' })
  @ApiResponse({ status: 404, description: 'Session not found' })
  endSession(@Param('id') id: string) {
    return this.visitSessionService.endSession(id);
  }

  @Public()
  @Get('visit_count')
  @ApiOperation({ summary: 'Get total visit session count' })
  @ApiResponse({ status: 200, description: 'Returns total session count' })
  visitCount() {
    return this.visitSessionService.visitCount();
  }
}
