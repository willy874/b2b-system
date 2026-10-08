import type { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { describe, expect, it } from 'vitest';

import { ExternalApi, Surface } from '@/common/decorators';

import { SurfaceGuard } from '../surface.guard';
import type { ProcessSurface } from '../surface.guard';

class InternalController {
  list(): void {}
}

@ExternalApi()
class ExternalController {
  list(): void {}
}

@Surface('both')
class HealthController {
  check(): void {}
}

type AnyController =
  | typeof InternalController
  | typeof ExternalController
  | typeof HealthController;

function contextOf(controller: AnyController, type: 'http' | 'ws' = 'http'): ExecutionContext {
  const instance = new controller() as { list?: () => void; check?: () => void };
  const handler = instance.list ?? instance.check;
  return {
    getType: () => type,
    getHandler: () => handler,
    getClass: () => controller,
  } as unknown as ExecutionContext;
}

const guardOf = (surface: ProcessSurface) => new SurfaceGuard(new Reflector(), surface);

describe('SurfaceGuard（docs/architecture/06-external-api.md §9.2 D11）', () => {
  it('沒標的路由屬於內部 api：內部 api 放行、對外 API 回 NOT_FOUND', () => {
    expect(guardOf('internal').canActivate(contextOf(InternalController))).toBe(true);
    expect(() => guardOf('external').canActivate(contextOf(InternalController))).toThrow(
      expect.objectContaining({ code: 'NOT_FOUND' }),
    );
  });

  it('@ExternalApi() 的路由：對外 API 放行、內部 api 回 NOT_FOUND', () => {
    expect(guardOf('external').canActivate(contextOf(ExternalController))).toBe(true);
    expect(() => guardOf('internal').canActivate(contextOf(ExternalController))).toThrow(
      expect.objectContaining({ code: 'NOT_FOUND' }),
    );
  });

  it("@Surface('both') 的路由兩個程序都放行", () => {
    expect(guardOf('internal').canActivate(contextOf(HealthController))).toBe(true);
    expect(guardOf('external').canActivate(contextOf(HealthController))).toBe(true);
  });

  it('WebSocket 不經過入口判斷', () => {
    expect(guardOf('external').canActivate(contextOf(ExternalController, 'ws'))).toBe(true);
  });
});
