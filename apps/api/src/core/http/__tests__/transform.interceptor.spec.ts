import type { CallHandler, ExecutionContext } from '@nestjs/common';
import { firstValueFrom, of } from 'rxjs';
import { describe, expect, it } from 'vitest';

import { TransformInterceptor } from '../transform.interceptor';

function contextOf(type: 'http' | 'ws'): ExecutionContext {
  return { getType: () => type } as unknown as ExecutionContext;
}

function handlerOf<T>(value: T): CallHandler<T> {
  return { handle: () => of(value) };
}

describe('TransformInterceptor（docs/architecture/backend/03-api-conventions.md §1）', () => {
  const interceptor = new TransformInterceptor<unknown>();

  it('HTTP 的回傳值包成 { data }', async () => {
    const result = interceptor.intercept(contextOf('http'), handlerOf({ id: 1 }));
    await expect(firstValueFrom(result)).resolves.toEqual({ data: { id: 1 } });
  });

  it('HTTP 沒有回傳值（204）→ 不包', async () => {
    const result = interceptor.intercept(contextOf('http'), handlerOf(undefined));
    await expect(firstValueFrom(result)).resolves.toBeUndefined();
  });

  it('WebSocket 的 ack 原樣回傳（Nest 12 起全域 interceptor 也套用到 gateway；08-realtime.md §4）', async () => {
    const result = interceptor.intercept(contextOf('ws'), handlerOf({ ok: true }));
    await expect(firstValueFrom(result)).resolves.toEqual({ ok: true });
  });
});
