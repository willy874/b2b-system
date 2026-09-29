import { Body, Controller, Get, HttpCode, Param, Post, Query, Req, Res } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { z } from 'zod';

import { Public } from '@/common/decorators';
import { AUTH_THROTTLE } from '@/common/rate-limit';
import type { Env } from '@/core/config';
import { AppException } from '@/core/errors';
import { ApiZodBody, ApiZodResponse, ZodValidationPipe } from '@/core/validation';

import {
  ExternalCallbackQuerySchema,
  ExternalCompleteQuerySchema,
  LoginSchema,
  SsoDiscoveryQuerySchema,
  SsoDiscoverySchema,
  SsoInteractionSchema,
  SsoRedirectSchema,
  StartExternalLoginSchema,
} from './dto/auth.dto';
import type {
  ExternalCallbackQueryDto,
  ExternalCompleteQueryDto,
  LoginDto,
  SsoDiscoveryQueryDto,
  StartExternalLoginDto,
} from './dto/auth.dto';
import { ExternalLoginService } from './external-login.service';
import { SsoService } from './sso.service';

/** provider 產生的互動 id（nanoid）；只接受這個形狀，才能安全地放進轉址網址。 */
const InteractionUidPipe = new ZodValidationPipe(z.string().regex(/^[A-Za-z0-9_-]{8,64}$/));

/**
 * IdP 的登入互動（docs/adr/0019-sso-identity-platform.md）。
 * provider 把互動 cookie 設在 `/api/oidc-interaction/:uid`，所以互動網址先到這裡，再 302 到 apps/auth 的頁面；
 * 頁面之後呼叫同一個路徑底下的端點，瀏覽器才會帶上那個 cookie。全部是 `@Public()`：互動 cookie 就是憑證。
 */
@ApiTags('auth')
@Controller('oidc-interaction')
export class SsoInteractionController {
  constructor(
    private readonly sso: SsoService,
    private readonly external: ExternalLoginService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  // ── 外部 IdP（docs/adr/0019-sso-identity-platform.md D8–D10）─────────────────
  // 固定路徑的 callback 放在 `:uid` 路由之前，避免被當成互動 id

  @Get('external/callback')
  @Public()
  @Throttle({ default: AUTH_THROTTLE })
  @ApiOperation({ summary: '外部 IdP 的 redirect URI（固定路徑）：驗證後跳到互動路徑底下完成互動' })
  async externalCallback(
    @Query(new ZodValidationPipe(ExternalCallbackQuerySchema)) query: ExternalCallbackQueryDto,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    const raw = req.originalUrl.includes('?')
      ? req.originalUrl.slice(req.originalUrl.indexOf('?') + 1)
      : '';
    res.redirect(302, await this.external.callback(query, raw));
  }

  @Get(':uid')
  @Public()
  @ApiOperation({ summary: '轉到 apps/auth 的登入互動頁（互動 cookie 已設在這個路徑）' })
  toPage(@Param('uid', InteractionUidPipe) uid: string, @Res() res: Response): void {
    // 直接寫回應：回傳值會被 TransformInterceptor 包成 `{ data }`，`@Redirect()` 不生效
    res.redirect(302, `${this.config.get('AUTH_APP_URL', { infer: true })}/interaction/${uid}`);
  }

  @Get(':uid/details')
  @Public()
  @ApiOperation({ summary: '登入互動的資訊（哪個產品要求登入）' })
  @ApiZodResponse(200, SsoInteractionSchema)
  details(
    @Param('uid', InteractionUidPipe) uid: string,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    return this.sso.interaction(req, res, uid);
  }

  @Post(':uid/login')
  @HttpCode(200)
  @Public()
  @Throttle({ default: AUTH_THROTTLE })
  @ApiOperation({ summary: '密碼登入；回傳要頂層跳轉的 resume 網址' })
  @ApiZodBody(LoginSchema)
  @ApiZodResponse(200, SsoRedirectSchema)
  login(
    @Param('uid', InteractionUidPipe) uid: string,
    @Body(new ZodValidationPipe(LoginSchema)) dto: LoginDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    return this.sso.login(req, res, uid, dto);
  }

  @Get(':uid/discover')
  @Public()
  @Throttle({ default: AUTH_THROTTLE })
  @ApiOperation({ summary: '以 email 網域查詢外部 IdP 連線（home realm discovery）' })
  @ApiZodResponse(200, SsoDiscoverySchema)
  discover(
    @Param('uid', InteractionUidPipe) uid: string,
    @Query(new ZodValidationPipe(SsoDiscoveryQuerySchema)) query: SsoDiscoveryQueryDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    return this.external.discover(req, res, uid, query.email);
  }

  @Post(':uid/external')
  @HttpCode(200)
  @Public()
  @Throttle({ default: AUTH_THROTTLE })
  @ApiOperation({ summary: '以外部 IdP 登入：回傳要頂層跳轉的外部授權網址' })
  @ApiZodBody(StartExternalLoginSchema)
  @ApiZodResponse(200, SsoRedirectSchema)
  startExternal(
    @Param('uid', InteractionUidPipe) uid: string,
    @Body(new ZodValidationPipe(StartExternalLoginSchema)) dto: StartExternalLoginDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    return this.external.start(req, res, uid, dto.providerId);
  }

  @Get(':uid/external/complete')
  @Public()
  @ApiOperation({
    summary: '外部 IdP 登入的最後一步（帶得到互動 cookie）：完成互動並跳回 provider',
  })
  async completeExternal(
    @Param('uid', InteractionUidPipe) uid: string,
    @Query(new ZodValidationPipe(ExternalCompleteQuerySchema)) query: ExternalCompleteQueryDto,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    try {
      res.redirect(303, await this.external.complete(req, res, uid, query.ticket));
    } catch (error) {
      if (!(error instanceof AppException)) throw error;
      res.redirect(302, this.external.errorPage(uid, error.code));
    }
  }

  @Post(':uid/abort')
  @HttpCode(200)
  @Public()
  @ApiOperation({ summary: '取消登入；產品收到 error=access_denied' })
  @ApiZodResponse(200, SsoRedirectSchema)
  abort(
    @Param('uid', InteractionUidPipe) uid: string,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    return this.sso.abort(req, res, uid);
  }
}
