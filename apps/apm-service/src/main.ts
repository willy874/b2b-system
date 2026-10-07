import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

import { loadConfig } from '@/config';
import { log } from '@/log';
import { createApmServer } from '@/server';
import { createServices } from '@/services';

const PACKAGE_ROOT = resolve(import.meta.dirname, '..');
const ROOT_ENV_FILE = resolve(PACKAGE_ROOT, '../../.env');
/** 每 6 小時清一次超過保留天數的事件檔。 */
const PURGE_INTERVAL_MS = 6 * 60 * 60 * 1000;

async function bootstrap(): Promise<void> {
  // 與 apps/api 共用根目錄的 .env；已經設定在環境中的變數不會被覆蓋
  if (existsSync(ROOT_ENV_FILE)) process.loadEnvFile(ROOT_ENV_FILE);

  const config = loadConfig(process.env, PACKAGE_ROOT);
  const services = await createServices(config);
  const server = createApmServer({ services });

  const purge = async (): Promise<void> => {
    try {
      const removed = await services.events.purgeOlderThan(config.retentionDays);
      if (removed > 0)
        log.info('已刪除過期的事件檔', { removed, retentionDays: config.retentionDays });
    } catch (error) {
      log.error('刪除過期事件檔失敗', {
        err: error instanceof Error ? error.message : String(error),
      });
    }
  };
  await purge();
  const purgeTimer = setInterval(() => void purge(), PURGE_INTERVAL_MS);
  purgeTimer.unref();

  server.listen(config.port, config.host, () => {
    log.info('apm-service 已啟動', {
      endpoint: `http://${config.host}:${config.port}`,
      dataDir: config.dataDir,
      projects: config.projects.map((project) => `${project.id}:${project.slug}`),
    });
  });

  const shutdown = (signal: string): void => {
    log.info('apm-service 關閉中', { signal });
    clearInterval(purgeTimer);
    server.close(() => process.exit(0));
    server.closeIdleConnections();
  };
  process.once('SIGINT', () => shutdown('SIGINT'));
  process.once('SIGTERM', () => shutdown('SIGTERM'));
}

bootstrap().catch((error: unknown) => {
  log.error('apm-service 啟動失敗', {
    err: error instanceof Error ? { message: error.message, stack: error.stack } : String(error),
  });
  process.exit(1);
});
