import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';

import { AppModule } from './app.module';
import { auditRoutes } from './common/route-audit';
import type { Env } from './core/config';
import { setupSwagger } from './swagger';

/** 要大於反向代理對 upstream 的 keepalive_timeout（60 秒）。 */
const HTTP_KEEP_ALIVE_TIMEOUT_MS = 65_000;

async function bootstrap(): Promise<void> {
  // 不設 global prefix：dev 由 Vite proxy、prod 由反向代理去掉 `/api` 前綴後轉入
  // （docs/architecture/01-system.md §4）。
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bufferLogs: false });
  const config = app.get(ConfigService<Env, true>);

  // 在反向代理後面時才讀得到真正的客戶端 IP；realtime 的每 IP 限制也讀同一個設定
  app.set('trust proxy', config.get('TRUST_PROXY', { infer: true }));

  // 不外露框架（docs/issues/02-security.md SEC-13）；其餘安全標頭由前面的 nginx 加
  app.disable('x-powered-by');
  app.use(cookieParser());
  app.enableShutdownHooks();

  // ★ 路由稽核：任何未宣告授權的路由讓程序啟動失敗（預設拒絕的守門員）
  auditRoutes(app);

  setupSwagger(app, config.get('NODE_ENV', { infer: true }) !== 'production');

  const port = config.get('PORT', { infer: true });
  await app.listen(port);
  // nginx 對 api 維持長連線（upstream keepalive_timeout 60 秒，deploy/nginx.conf）：Node 這端要撐得比它久，
  // 否則 Node 先關掉閒置連線、nginx 剛好拿它送請求時會得到 502
  const server = app.getHttpServer();
  server.keepAliveTimeout = HTTP_KEEP_ALIVE_TIMEOUT_MS;
  server.headersTimeout = HTTP_KEEP_ALIVE_TIMEOUT_MS + 1000;
  Logger.log(`API listening on http://localhost:${port}`, 'Bootstrap');
}

void bootstrap();
