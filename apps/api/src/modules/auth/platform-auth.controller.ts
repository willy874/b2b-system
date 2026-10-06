import { Body, Controller, Get, HttpCode, Patch, Post, Query, Req, Res } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';

import { Authenticated, CurrentUser, JsonBodyOnly, Public } from '@/common/decorators';
import { extractBearer } from '@/common/guards';
import { RateLimit } from '@/common/rate-limit';
import type { AuthUser } from '@/common/types';
import type { Env } from '@/core/config';
import { AppException } from '@/core/errors';
import { ApiZodBody, ApiZodResponse, ZodValidationPipe } from '@/core/validation';

import type { IssuedSession } from './auth.service';
import {
  ChangePasswordSchema,
  PlatformProfileSchema,
  ResetPasswordSchema,
  SessionSchema,
  SetupSchema,
  SsoCallbackSchema,
  UpdatePlatformProfileSchema,
  VerifySetupSchema,
} from './dto/auth.dto';
import type {
  ChangePasswordDto,
  ResetPasswordDto,
  SetupDto,
  SsoCallbackDto,
  UpdatePlatformProfileDto,
} from './dto/auth.dto';
import { PlatformAuthService } from './platform-auth.service';

/**
 * 平台管理者在 apps/platform 的 session（docs/architecture/05-tenancy.md §10.2 D5）。
 * 形狀與 `/auth/*` 相同，refresh cookie 的 path 是 `PLATFORM_REFRESH_COOKIE_PATH`。
 * 只在 apps/platform 的網域有效（service 檢查），租戶網域上回 `PLATFORM_ONLY`。
 */
@ApiTags('platform-auth')
@Controller('platform/auth')
export class PlatformAuthController {
  constructor(
    private readonly platformAuth: PlatformAuthService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  @Post('sso/callback')
  @HttpCode(200)
  @Public()
  @RateLimit('auth')
  @JsonBodyOnly()
  @ApiOperation({ summary: 'apps/platform 的 BFF：授權碼 ＋ PKCE verifier 換平台管理者的 session' })
  @ApiZodBody(SsoCallbackSchema)
  @ApiZodResponse(200, SessionSchema)
  async ssoCallback(
    @Body(new ZodValidationPipe(SsoCallbackSchema)) dto: SsoCallbackDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const session = await this.platformAuth.ssoCallback(dto, {
      ip: req.ip,
      userAgent: req.header('user-agent'),
    });
    return this.respondWithSession(res, session);
  }

  @Post('refresh')
  @HttpCode(200)
  @Public()
  @RateLimit('refresh')
  @ApiOperation({ summary: '以 refresh token 續期（需 x-refresh-request: 1）' })
  @ApiZodResponse(200, SessionSchema)
  async refresh(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    // CSRF 緩解：同 /auth/refresh
    if (req.header('x-refresh-request') !== '1') throw new AppException('AUTH_REFRESH_INVALID');
    const raw = this.readRefreshCookie(req);
    if (!raw) throw new AppException('AUTH_REFRESH_INVALID');
    const session = await this.platformAuth.refresh(raw, {
      ip: req.ip,
      userAgent: req.header('user-agent'),
    });
    return this.respondWithSession(res, session);
  }

  @Post('logout')
  @HttpCode(200)
  // 同 /auth/logout：bearer 可有可無，沒有時以 refresh cookie 登出（需 x-refresh-request: 1）
  @Public()
  @RateLimit('refresh')
  @ApiOperation({
    summary:
      '平台管理者登出：撤銷 refresh 家族並結束 IdP session。沒有 bearer 時以 refresh cookie 認人（需 x-refresh-request: 1）',
  })
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const result = await this.platformAuth.logout({
      refreshToken: this.readRefreshCookie(req),
      accessToken: extractBearer(req.headers.authorization),
      refreshRequested: req.header('x-refresh-request') === '1',
    });
    res.clearCookie(this.cookieName, { path: this.cookiePath });
    return result;
  }

  // ── 帳號流程：平台管理者從信中連結設定密碼（連結不帶 `?tenant=`）──

  @Get('setup/verify')
  @Public()
  @RateLimit('auth')
  @ApiOperation({ summary: '檢查平台管理者的啟用 token（回傳 email 供畫面顯示）' })
  verifySetup(@Query(new ZodValidationPipe(VerifySetupSchema)) query: { token: string }) {
    return this.platformAuth.verifySetupToken(query.token);
  }

  @Post('setup')
  @HttpCode(200)
  @Public()
  @RateLimit('auth')
  @ApiOperation({ summary: '平台管理者以啟用信設定密碼' })
  @ApiZodBody(SetupSchema)
  setup(@Body(new ZodValidationPipe(SetupSchema)) dto: SetupDto) {
    return this.platformAuth.setup(dto);
  }

  @Post('reset-password')
  @HttpCode(200)
  @Public()
  @RateLimit('auth')
  @ApiOperation({ summary: '平台管理者以重設密碼信設定新密碼（結束所有 session）' })
  @ApiZodBody(ResetPasswordSchema)
  resetPassword(@Body(new ZodValidationPipe(ResetPasswordSchema)) dto: ResetPasswordDto) {
    return this.platformAuth.resetPassword(dto);
  }

  @Get('profile')
  @Authenticated()
  @ApiOperation({ summary: '平台管理者自己的身分' })
  @ApiZodResponse(200, PlatformProfileSchema)
  profile(@CurrentUser() actor: AuthUser) {
    return this.platformAuth.getProfile(actor);
  }

  @Patch('profile')
  @Authenticated()
  @ApiOperation({ summary: '平台管理者改自己的顯示名稱' })
  @ApiZodBody(UpdatePlatformProfileSchema)
  @ApiZodResponse(200, PlatformProfileSchema)
  updateProfile(
    @Body(new ZodValidationPipe(UpdatePlatformProfileSchema)) dto: UpdatePlatformProfileDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.platformAuth.updateProfile(dto, actor);
  }

  @Post('change-password')
  @HttpCode(200)
  @Authenticated()
  @RateLimit('auth')
  @ApiOperation({ summary: '平台管理者以目前的密碼換新密碼（結束所有 session）' })
  @ApiZodBody(ChangePasswordSchema)
  changePassword(
    @Body(new ZodValidationPipe(ChangePasswordSchema)) dto: ChangePasswordDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.platformAuth.changePassword(dto, actor);
  }

  private get cookieName(): string {
    return this.config.get('REFRESH_COOKIE_NAME', { infer: true });
  }

  private get cookiePath(): string {
    return this.config.get('PLATFORM_REFRESH_COOKIE_PATH', { infer: true });
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
      path: this.cookiePath,
      maxAge: refreshTtlSeconds * 1000,
    });
    return rest;
  }
}
