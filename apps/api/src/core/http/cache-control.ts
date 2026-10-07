import { Inject, Injectable, Optional, SetMetadata } from '@nestjs/common';
import type { CallHandler, ExecutionContext, NestInterceptor } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request, Response } from 'express';
import type { Observable } from 'rxjs';

const NO_STORE_METADATA = 'http:noStore';

/** 一般資料的 `GET`：瀏覽器可以存，但每次都要向伺服器確認（Express 的弱 ETag 讓沒變的回應是 304）。 */
export const CACHE_CONTROL_REVALIDATE = 'private, no-cache';
/** 不留在瀏覽器的磁碟快取：寫入、憑證與 session、稽核紀錄。 */
export const CACHE_CONTROL_NO_STORE = 'no-store';

/** 登出的回應帶 `Clear-Site-Data`：清掉這個網域的 HTTP 快取（不動 cookie 與 storage）。 */
export const CLEAR_SITE_DATA_CACHE = '"cache"';

/** 整個程序 `GET` 的預設值（對外 API 的程序提供 `no-store`）；沒提供時是 `CACHE_CONTROL_REVALIDATE`。 */
export const CACHE_CONTROL_DEFAULT = Symbol('CACHE_CONTROL_DEFAULT');

/**
 * 回應不進瀏覽器的磁碟快取（docs/architecture/backend/03-api-conventions.md §9.1）：登入與 session、
 * 自己的 API token、稽核紀錄這類「登出後不該留在共用電腦上」的端點。標在 controller 或方法上。
 */
export const NoStore = () => SetMetadata(NO_STORE_METADATA, true);

/**
 * 明確的 `Cache-Control`（docs/architecture/backend/03-api-conventions.md §9.1）：`GET`／`HEAD` 預設
 * `private, no-cache`，其餘方法與 `@NoStore()` 的端點 `no-store`。在 handler **之前** 設定，
 * 自己寫標頭的端點（影像 API 的 302 帶 `private, max-age`）照常覆寫。
 * 整個程序都不該被快取的入口（對外 API）以 `CACHE_CONTROL_DEFAULT` 換掉預設值。
 */
@Injectable()
export class CacheControlInterceptor implements NestInterceptor {
  private readonly defaultValue: string;

  constructor(
    private readonly reflector: Reflector,
    @Optional() @Inject(CACHE_CONTROL_DEFAULT) defaultValue?: string,
  ) {
    this.defaultValue = defaultValue ?? CACHE_CONTROL_REVALIDATE;
  }

  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (ctx.getType() !== 'http') return next.handle();
    const http = ctx.switchToHttp();
    const method = http.getRequest<Request>().method;
    const noStore =
      (method !== 'GET' && method !== 'HEAD') ||
      this.reflector.getAllAndOverride<boolean>(NO_STORE_METADATA, [
        ctx.getHandler(),
        ctx.getClass(),
      ]);
    http
      .getResponse<Response>()
      .setHeader('Cache-Control', noStore ? CACHE_CONTROL_NO_STORE : this.defaultValue);
    return next.handle();
  }
}
