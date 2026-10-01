import { Injectable } from '@nestjs/common';
import type { CallHandler, ExecutionContext, NestInterceptor } from '@nestjs/common';
import type { Observable } from 'rxjs';
import { map } from 'rxjs/operators';

/**
 * 所有成功的 HTTP 回應都包成 `{ data: ... }`（docs/architecture/backend/03-api-conventions.md §1）。
 *
 * Nest 12 起 `APP_INTERCEPTOR` 也套用到 WebSocket gateway；ack 的形狀由 `@b2b-system/realtime` 的協定決定
 * （例：`SessionRenewResult`），不包信封（docs/architecture/backend/08-realtime.md §4）。
 */
@Injectable()
export class TransformInterceptor<T> implements NestInterceptor<T, T | { data: T } | undefined> {
  intercept(ctx: ExecutionContext, next: CallHandler<T>): Observable<T | { data: T } | undefined> {
    if (ctx.getType() !== 'http') return next.handle();
    return next.handle().pipe(map((data) => (data === undefined ? undefined : { data })));
  }
}
