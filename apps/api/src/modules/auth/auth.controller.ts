import { Body, Controller, Get, HttpCode, Patch, Post, Query, Req, Res } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';

import { Authenticated, CurrentUser, Public } from '@/common/decorators';
import { AUTH_THROTTLE, FORGOT_PASSWORD_THROTTLE, REFRESH_THROTTLE } from '@/common/rate-limit';
import type { AuthUser } from '@/common/types';
import type { Env } from '@/core/config';
import { AppException } from '@/core/errors';
import { ApiZodBody, ApiZodResponse, ZodValidationPipe } from '@/core/validation';

import { AuthService } from './auth.service';
import type { IssuedSession } from './auth.service';
import {
  ChangePasswordSchema,
  ForgotPasswordSchema,
  LoginSchema,
  ProfileSchema,
  ResetPasswordSchema,
  SessionSchema,
  SetupSchema,
  UpdateProfileSchema,
  VerifySetupSchema,
} from './dto/auth.dto';
import type {
  ChangePasswordDto,
  ForgotPasswordDto,
  LoginDto,
  ResetPasswordDto,
  SetupDto,
  UpdateProfileDto,
} from './dto/auth.dto';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  @Post('login')
  @HttpCode(200)
  @Public()
  @Throttle({ default: AUTH_THROTTLE })
  @ApiOperation({ summary: '帳密登入' })
  @ApiZodBody(LoginSchema)
  @ApiZodResponse(200, SessionSchema)
  async login(
    @Body(new ZodValidationPipe(LoginSchema)) dto: LoginDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const session = await this.authService.login(dto, {
      ip: req.ip,
      userAgent: req.header('user-agent'),
    });
    return this.respondWithSession(res, session);
  }

  @Post('refresh')
  @HttpCode(200)
  @Public()
  @Throttle({ default: REFRESH_THROTTLE })
  @ApiOperation({ summary: '以 refresh token 續期（需 x-refresh-request: 1）' })
  @ApiZodResponse(200, SessionSchema)
  async refresh(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    // CSRF 緩解：帶自訂標頭的跨站請求會觸發 preflight，而我們不回應其他來源的 CORS
    if (req.header('x-refresh-request') !== '1') {
      throw new AppException('AUTH_REFRESH_INVALID');
    }
    const raw = this.readRefreshCookie(req);
    if (!raw) throw new AppException('AUTH_REFRESH_INVALID');

    const session = await this.authService.refresh(raw, {
      ip: req.ip,
      userAgent: req.header('user-agent'),
    });
    return this.respondWithSession(res, session);
  }

  @Post('logout')
  @HttpCode(200)
  @Authenticated()
  async logout(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @CurrentUser() actor: AuthUser,
  ) {
    const result = await this.authService.logout(this.readRefreshCookie(req), actor);
    res.clearCookie(this.cookieName, { path: this.cookiePath });
    return result;
  }

  @Get('profile')
  @Authenticated()
  @ApiOperation({ summary: '自己的身分、角色與扁平化權限集合' })
  @ApiZodResponse(200, ProfileSchema)
  profile(@CurrentUser() actor: AuthUser) {
    return this.authService.getProfile(actor);
  }

  @Patch('profile')
  @Authenticated()
  @ApiZodBody(UpdateProfileSchema)
  @ApiZodResponse(200, ProfileSchema)
  updateProfile(
    @Body(new ZodValidationPipe(UpdateProfileSchema)) dto: UpdateProfileDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.authService.updateProfile(dto, actor);
  }

  @Post('change-password')
  @HttpCode(200)
  @Authenticated()
  @ApiZodBody(ChangePasswordSchema)
  changePassword(
    @Body(new ZodValidationPipe(ChangePasswordSchema)) dto: ChangePasswordDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.authService.changePassword(dto, actor);
  }

  @Post('forgot-password')
  @HttpCode(200)
  @Public()
  @Throttle({ default: FORGOT_PASSWORD_THROTTLE })
  @ApiOperation({ summary: '請求密碼重設信（永遠回 200）' })
  @ApiZodBody(ForgotPasswordSchema)
  forgotPassword(@Body(new ZodValidationPipe(ForgotPasswordSchema)) dto: ForgotPasswordDto) {
    return this.authService.forgotPassword(dto);
  }

  @Post('reset-password')
  @HttpCode(200)
  @Public()
  @Throttle({ default: AUTH_THROTTLE })
  @ApiZodBody(ResetPasswordSchema)
  resetPassword(@Body(new ZodValidationPipe(ResetPasswordSchema)) dto: ResetPasswordDto) {
    return this.authService.resetPassword(dto);
  }

  @Get('setup/verify')
  @Public()
  verifySetup(@Query(new ZodValidationPipe(VerifySetupSchema)) query: { token: string }) {
    return this.authService.verifySetupToken(query.token);
  }

  @Post('setup')
  @HttpCode(200)
  @Public()
  @Throttle({ default: AUTH_THROTTLE })
  @ApiZodBody(SetupSchema)
  setup(@Body(new ZodValidationPipe(SetupSchema)) dto: SetupDto) {
    return this.authService.setup(dto);
  }

  // ── 私有 ────────────────────────────────────────────────

  private get cookieName(): string {
    return this.config.get('REFRESH_COOKIE_NAME', { infer: true });
  }

  private get cookiePath(): string {
    return this.config.get('REFRESH_COOKIE_PATH', { infer: true });
  }

  private readRefreshCookie(req: Request): string | undefined {
    const cookies = (req as Request & { cookies?: Record<string, string> }).cookies;
    return cookies?.[this.cookieName];
  }

  private respondWithSession(res: Response, session: IssuedSession) {
    const { refreshToken, refreshTtlSeconds, ...rest } = session;
    res.cookie(this.cookieName, refreshToken, {
      httpOnly: true,
      secure: this.config.get('NODE_ENV', { infer: true }) === 'production',
      sameSite: 'lax',
      // 一般 API 請求不會攜帶這個 cookie（只有 refresh / logout 會）
      path: this.cookiePath,
      maxAge: refreshTtlSeconds * 1000,
    });
    return rest;
  }
}
