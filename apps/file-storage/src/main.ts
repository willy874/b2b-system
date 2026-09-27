import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

import { loadConfig } from '@/config';
import { log } from '@/log';
import { createFileStorageServer } from '@/server';
import { DiskStore } from '@/storage/disk-store';

const PACKAGE_ROOT = resolve(import.meta.dirname, '..');
const ROOT_ENV_FILE = resolve(PACKAGE_ROOT, '../../.env');

async function bootstrap(): Promise<void> {
  // 與 apps/api 共用根目錄的 .env；已經設定在環境中的變數不會被覆蓋
  if (existsSync(ROOT_ENV_FILE)) process.loadEnvFile(ROOT_ENV_FILE);

  const config = loadConfig(process.env, PACKAGE_ROOT);
  const store = await DiskStore.open(config.dataDir);
  const server = createFileStorageServer({ config, store });

  server.listen(config.port, config.host, () => {
    log.info('file-storage 已啟動', {
      endpoint: `http://${config.host}:${config.port}`,
      dataDir: config.dataDir,
    });
  });

  const shutdown = (signal: string): void => {
    log.info('file-storage 關閉中', { signal });
    server.close(() => process.exit(0));
    server.closeIdleConnections();
  };
  process.once('SIGINT', () => shutdown('SIGINT'));
  process.once('SIGTERM', () => shutdown('SIGTERM'));
}

bootstrap().catch((error: unknown) => {
  log.error('file-storage 啟動失敗', {
    err: error instanceof Error ? { message: error.message, stack: error.stack } : String(error),
  });
  process.exit(1);
});
