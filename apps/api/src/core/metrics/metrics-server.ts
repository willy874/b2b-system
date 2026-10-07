import { createServer } from 'node:http';
import type { IncomingMessage, Server, ServerResponse } from 'node:http';

import { Injectable, Logger } from '@nestjs/common';
import type { OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { listenHostOf } from '../config/env.schema';
import type { Env } from '../config/env.schema';
import { enableDefaultMetrics, metricsRegistry } from './registry';

/**
 * `GET /metrics` 的處理（Prometheus 文字格式）。其他路徑一律 404：這個 port 上沒有別的東西。
 * 獨立成函式，測試不必真的開 port。
 */
export async function handleMetricsRequest(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const path = req.url?.split('?')[0];
  if (path !== '/metrics' || (req.method !== 'GET' && req.method !== 'HEAD')) {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end('not found');
    return;
  }
  try {
    const body = await metricsRegistry.metrics();
    res.writeHead(200, { 'content-type': metricsRegistry.contentType });
    res.end(req.method === 'HEAD' ? undefined : body);
  } catch {
    res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' }).end('metrics failed');
  }
}

/**
 * 這個程序的 `/metrics` 要開在哪個 port；`0` = 不開。監控整套關閉（`MONITORING_ENABLED=false`）時一律 `0`，
 * 不看 `METRICS_PORT`／`EXTERNAL_METRICS_PORT`（docs/architecture/08-monitoring.md §1.1）。
 */
export function metricsPortOf(
  env: Pick<Env, 'MONITORING_ENABLED' | 'API_SURFACE' | 'METRICS_PORT' | 'EXTERNAL_METRICS_PORT'>,
): number {
  if (!env.MONITORING_ENABLED) return 0;
  return env.API_SURFACE === 'external' ? env.EXTERNAL_METRICS_PORT : env.METRICS_PORT;
}

/**
 * 給 Prometheus 抓指標的獨立 HTTP server（docs/architecture/08-monitoring.md §2.1、§6.2 D2）。
 * 不掛在 Nest 的路由上：不經過租戶解析、驗證與限流，nginx 也只轉發 api 的 port，瀏覽器碰不到這裡。
 * 開不起來（port 被占用）只記錄、不讓 api 停止服務：指標不是 api 的必要功能。
 */
@Injectable()
export class MetricsServer implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(MetricsServer.name);
  private readonly port: number;
  private readonly host: string | undefined;
  private server: Server | undefined;

  constructor(config: ConfigService<Env, true>) {
    this.port = metricsPortOf({
      MONITORING_ENABLED: config.get('MONITORING_ENABLED', { infer: true }),
      API_SURFACE: config.get('API_SURFACE', { infer: true }),
      METRICS_PORT: config.get('METRICS_PORT', { infer: true }),
      EXTERNAL_METRICS_PORT: config.get('EXTERNAL_METRICS_PORT', { infer: true }),
    });
    this.host = listenHostOf({
      NODE_ENV: config.get('NODE_ENV', { infer: true }),
      LISTEN_HOST: config.get('LISTEN_HOST', { infer: true }),
    });
  }

  onApplicationBootstrap(): Promise<void> {
    if (this.port === 0) return Promise.resolve();
    enableDefaultMetrics();
    const server = createServer((req, res) => void handleMetricsRequest(req, res));
    return new Promise((resolve) => {
      server.once('error', (error) => {
        this.logger.error(
          { err: error, port: this.port },
          '指標的 port 開不起來，這個程序不提供 /metrics',
        );
        resolve();
      });
      server.listen(this.port, this.host, () => {
        this.server = server;
        this.logger.log(
          `Metrics listening on http://${this.host ?? '0.0.0.0'}:${this.port}/metrics`,
        );
        resolve();
      });
    });
  }

  async onApplicationShutdown(): Promise<void> {
    const server = this.server;
    this.server = undefined;
    if (!server) return;
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}
