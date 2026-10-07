import { Body, Controller, Get, HttpCode, Param, Post, Query, Req, Res } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';

import { Public } from '@/common/decorators';
import { RateLimit } from '@/common/rate-limit';
import type { Env } from '@/core/config';
import { AppException } from '@/core/errors';
import { NoStore } from '@/core/http';
import { ApiZodBody, ApiZodResponse, ZodValidationPipe } from '@/core/validation';
import { SsoLoginResultSchema } from '@/modules/mfa/dto/mfa.dto';
import { InteractionUidPipe } from '@/modules/oidc-provider/interaction-uid';

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

/**
 * IdP 的登入互動（docs/architecture/04-sso.md §12）。
 * provider 把互動 cookie 設在 `/api/oidc-interaction/:uid`，所以互動網址先到這裡，再 302 到 apps/platform 的頁面；
 * 頁面之後呼叫同一個路徑底下的端點，瀏覽器才會帶上那個 cookie。全部是 `@Public()`：互動 cookie 就是憑證。
 */
@ApiTags('auth')
@Controller('oidc-interaction')
@NoStore()
export class SsoInteractionController {
  constructor(
    private readonly sso: SsoService,
    private readonly external: ExternalLoginService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  // ── 外部 IdP（docs/architecture/04-sso.md §12.2 D8–D10）─────────────────
  // 固定路徑的 callback 放在 `:uid` 路由之前，避免被當成互動 id

  @Get('external/callback')
  @Public()
  @RateLimit('auth')
  @ApiOperation({ summary: '外部 IdP 的 redirect URI（固定路徑）：驗證後跳到互動路徑底下完成互動' })
  async externalCallback(
    @Query(new ZodValidationPipe(ExternalCallbackQuerySchema)) query: ExternalCallbackQueryDto,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    const raw = req.originalUrl.includes('?')
      ? req.originalUrl.slice(req.originalUrl.indexOf('?') + 1)
      : '';
    const cookies = (req as Request & { cookies?: Record<string, string> }).cookies;
    const result = await this.external.callback(query, raw, cookies);
    for (const cookie of result.clearCookies) res.clearCookie(cookie.name, { path: cookie.path });
    res.redirect(302, result.location);
  }

  @Get(':uid')
  @Public()
  @ApiOperation({ summary: '轉到 apps/platform 的登入互動頁（互動 cookie 已設在這個路徑）' })
  toPage(@Param('uid', InteractionUidPipe) uid: string, @Res() res: Response): void {
    // 直接寫回應：回傳值會被 TransformInterceptor 包成 `{ data }`，`@Redirect()` 不生效
    res.redirect(302, `${this.config.get('PLATFORM_APP_URL', { infer: true })}/interaction/${uid}`);
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
  @RateLimit('auth')
  @ApiOperation({
    summary: '密碼登入；不需要 MFA 時回傳要頂層跳轉的 resume 網址，需要時回傳下一步（next）',
  })
  @ApiZodBody(LoginSchema)
  @ApiZodResponse(200, SsoLoginResultSchema)
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
  @RateLimit('auth')
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
  @RateLimit('auth')
  @ApiOperation({ summary: '以外部 IdP 登入：回傳要頂層跳轉的外部授權網址' })
  @ApiZodBody(StartExternalLoginSchema)
  @ApiZodResponse(200, SsoRedirectSchema)
  async startExternal(
    @Param('uid', InteractionUidPipe) uid: string,
    @Body(new ZodValidationPipe(StartExternalLoginSchema)) dto: StartExternalLoginDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { redirectTo, binding } = await this.external.start(req, res, uid, dto.providerId);
    // 綁定 cookie：外部 IdP 跳回固定的 callback 時，必須是這個瀏覽器（docs/architecture/04-sso.md §3.3）
    res.cookie(binding.name, binding.value, binding.options);
    return { redirectTo };
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
