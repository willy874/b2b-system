import type { IncomingMessage, ServerResponse } from 'node:http';

import type { ApmConfig } from '@/config';
import type { RateLimiter } from '@/ingest/rate-limit';
import type { ApmMetrics } from '@/metrics/apm-metrics';
import type { SourcemapStore } from '@/sourcemaps/sourcemap-store';
import type { Symbolicator } from '@/sourcemaps/symbolicate';
import type { EventStore } from '@/store/event-store';

/** 程序層級、所有請求共用的物件。 */
export interface ApmServices {
  config: ApmConfig;
  events: EventStore;
  sourcemaps: SourcemapStore;
  symbolicator: Symbolicator;
  metrics: ApmMetrics;
  rateLimiter: RateLimiter;
  /** 測試可以固定時間。 */
  now: () => Date;
}

export interface RequestContext {
  req: IncomingMessage;
  res: ServerResponse;
  url: URL;
  /** 路由比對出來的路徑參數。 */
  params: Readonly<Record<string, string>>;
  requestId: string;
  services: ApmServices;
}

export function header(req: IncomingMessage, name: string): string | undefined {
  const value = req.headers[name];
  return Array.isArray(value) ? value.join(',') : value;
}

/** 來源 IP：在反向代理後面時信任 `X-Real-IP`（`APM_TRUST_PROXY`）。 */
export function clientIp(req: IncomingMessage, trustProxy: boolean): string {
  if (trustProxy) {
    const real = header(req, 'x-real-ip')?.trim();
    if (real) return real;
  }
  return req.socket.remoteAddress ?? 'unknown';
}
