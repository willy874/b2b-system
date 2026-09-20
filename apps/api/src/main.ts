import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import cookieParser from 'cookie-parser';

import { AppModule } from './app.module';
import { auditRoutes } from './common/route-audit';
import type { Env } from './core/config';
import { setupSwagger } from './swagger';

async function bootstrap(): Promise<void> {
  // 不設 global prefix：dev 由 Vite proxy、prod 由反向代理去掉 `/api` 前綴後轉入
  // （docs/02-architecture.md §4）。
  const app = await NestFactory.create(AppModule, { bufferLogs: false });
  const config = app.get(ConfigService<Env, true>);

  app.use(cookieParser());
  app.enableShutdownHooks();

  // ★ 路由稽核：任何未宣告授權的路由讓程序啟動失敗（預設拒絕的守門員）
  auditRoutes(app);

  setupSwagger(app, config.get('NODE_ENV', { infer: true }) !== 'production');

  const port = config.get('PORT', { infer: true });
  await app.listen(port);
  Logger.log(`API listening on http://localhost:${port}`, 'Bootstrap');
}

void bootstrap();
