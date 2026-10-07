import { EventEmitter } from 'node:events';

import type { NextFunction, Request, Response } from 'express';
import { describe, expect, it, vi } from 'vitest';

import { httpMetricsMiddleware } from '../http-metrics';
import { httpRequestDuration } from '../instruments';
import { routeLabelOf } from '../route-label';

function request(overrides: Partial<Request> = {}): Request {
  return { method: 'GET', baseUrl: '', ...overrides } as Request;
}

describe('routeLabelOf（路由標籤不用實際網址，docs/architecture/08-monitoring.md §2.2）', () => {
  it('用 Express 對到的路由樣板，不帶 id', () => {
    expect(routeLabelOf(request({ route: { path: '/users/:id' } }), 200)).toBe('/users/:id');
  });

  it('掛載在前綴下的路由加上前綴', () => {
    expect(routeLabelOf(request({ baseUrl: '/oidc', route: { path: '/token' } }), 200)).toBe(
      '/oidc/token',
    );
  });

  it('子應用程式自己處理的請求只取掛載點', () => {
    expect(routeLabelOf(request({ baseUrl: '/oidc' }), 302)).toBe('/oidc');
  });

  it('沒有對到任何路由的 404 歸成 unmatched：路徑由客戶端決定，不能當標籤', () => {
    expect(routeLabelOf(request(), 404)).toBe('unmatched');
  });

  it("只對到中介軟體的萬用路由（forRoutes('*') 的 /{*splat}）不算路由", () => {
    expect(routeLabelOf(request({ route: { path: '{/*splat}' } }), 404)).toBe('unmatched');
    expect(routeLabelOf(request({ route: { path: '/{*splat}' } }), 404)).toBe('unmatched');
    expect(routeLabelOf(request({ route: { path: '*' } }), 401)).toBe('other');
  });

  it('沒有路由、又不是 404（例：中介軟體直接回應）歸成 other', () => {
    expect(routeLabelOf(request(), 401)).toBe('other');
  });
});

describe('httpMetricsMiddleware', () => {
  it('回應結束時以方法、路由樣板與狀態碼記一筆', async () => {
    const res = Object.assign(new EventEmitter(), {
      statusCode: 201,
      headersSent: true,
    }) as unknown as Response;
    const req = request({ method: 'POST', route: { path: '/roles' } });
    const next = vi.fn() as NextFunction;

    httpMetricsMiddleware(req, res, next);
    expect(next).toHaveBeenCalledOnce();
    (res as unknown as EventEmitter).emit('close');

    const { values } = await httpRequestDuration.get();
    expect(values).toContainEqual(
      expect.objectContaining({
        metricName: 'http_server_request_duration_seconds_count',
        labels: { method: 'POST', route: '/roles', status: 201 },
        value: 1,
      }),
    );
  });

  it('客戶端在回應前斷線記成 499', async () => {
    const res = Object.assign(new EventEmitter(), {
      statusCode: 200,
      headersSent: false,
    }) as unknown as Response;

    httpMetricsMiddleware(request({ route: { path: '/slow' } }), res, vi.fn());
    (res as unknown as EventEmitter).emit('close');

    const { values } = await httpRequestDuration.get();
    expect(values).toContainEqual(
      expect.objectContaining({
        metricName: 'http_server_request_duration_seconds_count',
        labels: { method: 'GET', route: '/slow', status: 499 },
      }),
    );
  });
});
