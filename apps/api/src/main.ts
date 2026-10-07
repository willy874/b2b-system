import 'reflect-metadata';
// ★ 第一個 import 的專案檔：tracing 要在 http、express、Nest 被載入之前掛上（docs/architecture/08-monitoring.md §3）
import './instrumentation';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import { Logger as PinoLogger } from 'nestjs-pino';

import { AppModule } from './app.module';
import { auditRoutes } from './common/route-audit';
import { listenHostOf } from './core/config/env.schema';
import type { Env } from './core/config/env.schema';
import { httpMetricsMiddleware } from './core/metrics/http-metrics';
import { assertPermissionDependencies } from './db/seeds/permissions';
import { setupSwagger } from './swagger';

/** 要大於反向代理對 upstream 的 keepalive_timeout（60 秒）。 */
const HTTP_KEEP_ALIVE_TIMEOUT_MS = 65_000;

async function bootstrap(): Promise<void> {
  // 不設 global prefix：dev 由 Vite proxy、prod 由反向代理去掉 `/api` 前綴後轉入
  // （docs/architecture/01-system.md §4）。
  // 啟動期間的日誌先暫存，接上 Pino 之後才輸出：`new Logger(Xxx.name)` 的應用程式日誌與 HTTP 存取日誌
  // 都是同一個 Pino（JSON、帶 requestId、套用 redact；docs/conventions/03-backend.md §7）
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bufferLogs: true });
  app.useLogger(app.get(PinoLogger));
  const config = app.get(ConfigService<Env, true>);

  // 在反向代理後面時才讀得到真正的客戶端 IP；realtime 的每 IP 限制也讀同一個設定
  app.set('trust proxy', config.get('TRUST_PROXY', { infer: true }));

  // 不外露框架；其餘安全標頭由前面的 nginx 加
  app.disable('x-powered-by');
  // 最先量：被 guard 擋下、路由沒對到的請求也算（docs/architecture/08-monitoring.md §2.2）
  app.use(httpMetricsMiddleware);
  app.use(cookieParser());
  app.enableShutdownHooks();

  // ★ 路由稽核：任何未宣告授權的路由讓程序啟動失敗（預設拒絕的守門員）
  auditRoutes(app);
  // 權限依賴樹違反不變條件（循環、跨資源的子能力、包含受反提權限制的鍵）同樣讓程序啟動失敗
  assertPermissionDependencies();

  setupSwagger(app, config.get('NODE_ENV', { infer: true }) !== 'production');

  const port = config.get('PORT', { infer: true });
  // 開發環境只聽 127.0.0.1（LISTEN_HOST）；production 聽所有介面，nginx 從另一個容器連進來
  const host = listenHostOf({
    NODE_ENV: config.get('NODE_ENV', { infer: true }),
    LISTEN_HOST: config.get('LISTEN_HOST', { infer: true }),
  });
  await (host ? app.listen(port, host) : app.listen(port));
  // nginx 對 api 維持長連線（upstream keepalive_timeout 60 秒，deploy/nginx.conf）：Node 這端要撐得比它久，
  // 否則 Node 先關掉閒置連線、nginx 剛好拿它送請求時會得到 502
  const server = app.getHttpServer();
  server.keepAliveTimeout = HTTP_KEEP_ALIVE_TIMEOUT_MS;
  server.headersTimeout = HTTP_KEEP_ALIVE_TIMEOUT_MS + 1000;
  Logger.log(`API listening on http://localhost:${port}`, 'Bootstrap');
}

void bootstrap();
