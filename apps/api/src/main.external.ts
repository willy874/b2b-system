import 'reflect-metadata';
// ★ 第一個 import 的專案檔：在任何模組讀取設定之前覆寫這個程序固定的環境
import './external-process-env';
// tracing 要在 http、express、Nest 被載入之前掛上；在上一行之後，服務名稱才分得出是對外 API（docs/architecture/08-monitoring.md §3）
import './instrumentation';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Logger as PinoLogger } from 'nestjs-pino';

import { auditRoutes } from './common/route-audit';
import { listenHostOf } from './core/config/env.schema';
import type { Env } from './core/config/env.schema';
import { httpMetricsMiddleware } from './core/metrics/http-metrics';
import { assertPermissionDependencies } from './db/seeds/permissions';
import { ExternalApiModule } from './external-api.module';
import { setupSwagger } from './swagger';

/** 同 main.ts：要大於反向代理對 upstream 的 keepalive_timeout（60 秒）。 */
const HTTP_KEEP_ALIVE_TIMEOUT_MS = 65_000;

/**
 * 對外 API 的程序（docs/architecture/06-external-api.md §9.2 D9）：與 api 同一個映像、不同的進入點與 port。
 * 沒有 `/api` 前綴：對外網域整個交給這個程序，路徑就是 `/v1/...`。
 */
async function bootstrap(): Promise<void> {
  // 啟動期間的日誌先暫存，接上 Pino 之後才輸出：`new Logger(Xxx.name)` 的應用程式日誌與 HTTP 存取日誌
  // 都是同一個 Pino（JSON、帶 requestId、套用 redact；docs/coding-standards/03-backend.md §7）
  const app = await NestFactory.create<NestExpressApplication>(ExternalApiModule, {
    bufferLogs: true,
  });
  app.useLogger(app.get(PinoLogger));
  const config = app.get(ConfigService<Env, true>);

  app.set('trust proxy', config.get('TRUST_PROXY', { infer: true }));
  app.disable('x-powered-by');
  app.use(httpMetricsMiddleware);
  // 不讀 cookie：對外 API 只認 Authorization 標頭（D10）
  app.enableShutdownHooks();

  auditRoutes(app);
  assertPermissionDependencies();
  setupSwagger(app, config.get('NODE_ENV', { infer: true }) !== 'production', 'external');

  const port = config.get('EXTERNAL_API_PORT', { infer: true });
  // 同 main.ts：開發環境只聽 127.0.0.1
  const host = listenHostOf({
    NODE_ENV: config.get('NODE_ENV', { infer: true }),
    LISTEN_HOST: config.get('LISTEN_HOST', { infer: true }),
  });
  await (host ? app.listen(port, host) : app.listen(port));
  const server = app.getHttpServer();
  server.keepAliveTimeout = HTTP_KEEP_ALIVE_TIMEOUT_MS;
  server.headersTimeout = HTTP_KEEP_ALIVE_TIMEOUT_MS + 1000;
  Logger.log(`External API listening on http://localhost:${port}`, 'Bootstrap');
}

void bootstrap();
