import { Injectable, UseGuards } from '@nestjs/common';
import type { CanActivate, ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';

import { AppException } from '@/core/errors';

/**
 * 只接受 `Content-Type: application/json` 的請求（docs/architecture/backend/04-auth.md §2.5）。
 * 跨站的 HTML 表單只能送 urlencoded、multipart、text/plain；跨站的 fetch 帶 `application/json` 會觸發 preflight，
 * 而 api 不回其他來源的 CORS。所以會 **設定** session cookie 的公開端點（登入、SSO 回呼）加上它，
 * 別的網站就無法讓受害者的瀏覽器收下攻擊者的 refresh cookie（登入 CSRF）。
 * 不能全域關掉 urlencoded：`/oidc/token` 依規格要它。
 */
@Injectable()
export class JsonBodyOnlyGuard implements CanActivate {
  canActivate(ctx: ExecutionContext): boolean {
    if (ctx.switchToHttp().getRequest<Request>().is('application/json')) return true;
    throw new AppException('UNSUPPORTED_MEDIA_TYPE');
  }
}

/** 見 `JsonBodyOnlyGuard`。 */
export const JsonBodyOnly = () => UseGuards(JsonBodyOnlyGuard);
