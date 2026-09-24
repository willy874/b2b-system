import { Injectable } from '@nestjs/common';
import type { CallHandler, ExecutionContext, NestInterceptor } from '@nestjs/common';
import type { Observable } from 'rxjs';
import { map } from 'rxjs/operators';

/** 所有成功回應都包成 `{ data: ... }`（docs/architecture/backend/03-api-conventions.md §1）。 */
@Injectable()
export class TransformInterceptor<T> implements NestInterceptor<T, { data: T } | undefined> {
  intercept(_ctx: ExecutionContext, next: CallHandler<T>): Observable<{ data: T } | undefined> {
    return next.handle().pipe(map((data) => (data === undefined ? undefined : { data })));
  }
}
