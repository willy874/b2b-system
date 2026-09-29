import { Body, Controller, Get, HttpCode, Post, Req, Res } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';

import { Authenticated, CurrentUser, Public } from '@/common/decorators';
import { AUTH_THROTTLE, REFRESH_THROTTLE } from '@/common/rate-limit';
import type { AuthUser } from '@/common/types';
import type { Env } from '@/core/config';
import { AppException } from '@/core/errors';
import { ApiZodBody, ApiZodResponse, ZodValidationPipe } from '@/core/validation';

import type { IssuedSession } from './auth.service';
import { PlatformProfileSchema, SessionSchema, SsoCallbackSchema } from './dto/auth.dto';
import type { SsoCallbackDto } from './dto/auth.dto';
import { PlatformAuthService } from './platform-auth.service';

/**
 * 平台管理者在 apps/auth 的 session（docs/adr/0020-physical-tenant-isolation.md D5）。
 * 形狀與 `/auth/*` 相同，refresh cookie 的 path 是 `PLATFORM_REFRESH_COOKIE_PATH`。
 * 只在 apps/auth 的網域有效（service 檢查），租戶網域上回 `PLATFORM_ONLY`。
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
  @Throttle({ default: AUTH_THROTTLE })
  @ApiOperation({ summary: 'apps/auth 的 BFF：授權碼 ＋ PKCE verifier 換平台管理者的 session' })
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
  @Throttle({ default: REFRESH_THROTTLE })
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
  @Authenticated()
  async logout(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @CurrentUser() actor: AuthUser,
  ) {
    const result = await this.platformAuth.logout(this.readRefreshCookie(req), actor);
    res.clearCookie(this.cookieName, { path: this.cookiePath });
    return result;
  }

  @Get('profile')
  @Authenticated()
  @ApiOperation({ summary: '平台管理者自己的身分' })
  @ApiZodResponse(200, PlatformProfileSchema)
  profile(@CurrentUser() actor: AuthUser) {
    return this.platformAuth.getProfile(actor);
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
