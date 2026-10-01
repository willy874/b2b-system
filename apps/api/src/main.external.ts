import 'reflect-metadata';
// ★ 第一個 import 的專案檔：在任何模組讀取設定之前覆寫這個程序固定的環境
import './external-process-env';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';

import { auditRoutes } from './common/route-audit';
import type { Env } from './core/config';
import { assertPermissionDependencies } from './db/seeds/permissions';
import { ExternalApiModule } from './external-api.module';
import { setupSwagger } from './swagger';

/** 同 main.ts：要大於反向代理對 upstream 的 keepalive_timeout（60 秒）。 */
const HTTP_KEEP_ALIVE_TIMEOUT_MS = 65_000;

/**
 * 對外 API 的程序（docs/adr/0027-api-tokens-external-api.md D9）：與 api 同一個映像、不同的進入點與 port。
 * 沒有 `/api` 前綴：對外網域整個交給這個程序，路徑就是 `/v1/...`。
 */
async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(ExternalApiModule, {
    bufferLogs: false,
  });
  const config = app.get(ConfigService<Env, true>);

  app.set('trust proxy', config.get('TRUST_PROXY', { infer: true }));
  app.disable('x-powered-by');
  // 不讀 cookie：對外 API 只認 Authorization 標頭（D10）
  app.enableShutdownHooks();

  auditRoutes(app);
  assertPermissionDependencies();
  setupSwagger(app, config.get('NODE_ENV', { infer: true }) !== 'production', 'external');

  const port = config.get('EXTERNAL_API_PORT', { infer: true });
  await app.listen(port);
  const server = app.getHttpServer();
  server.keepAliveTimeout = HTTP_KEEP_ALIVE_TIMEOUT_MS;
  server.headersTimeout = HTTP_KEEP_ALIVE_TIMEOUT_MS + 1000;
  Logger.log(`External API listening on http://localhost:${port}`, 'Bootstrap');
}

void bootstrap();
