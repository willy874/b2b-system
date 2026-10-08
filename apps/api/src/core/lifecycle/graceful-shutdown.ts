import { setTimeout as delay } from 'node:timers/promises';

import { Logger } from '@nestjs/common';
import type { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type { Env } from '../config';
import { ShutdownState } from './shutdown-state';

const SHUTDOWN_SIGNALS = ['SIGTERM', 'SIGINT'] as const;

/**
 * 取代 `app.enableShutdownHooks()`（docs/architecture/01-system.md §7 D13）：收到訊號後先排空（readiness 回 503、
 * 等 `SHUTDOWN_DRAIN_SECONDS`），再 `app.close()` 走 Nest 原本的關閉順序。Nest 的 hook 從 `onModuleDestroy` 開始，
 * 沒有「關 HTTP 之前先等一下」的位置，所以排空放在訊號處理裡。
 *
 * 排空期間再收到一次訊號就照預設行為立即結束（例：開發時連按兩次 Ctrl-C）。
 */
export function enableGracefulShutdown(app: INestApplication): void {
  const logger = new Logger('GracefulShutdown');
  const state = app.get(ShutdownState);
  const drainMs =
    app
      .get<ConfigService<Env, true>>(ConfigService)
      .get('SHUTDOWN_DRAIN_SECONDS', { infer: true }) * 1000;

  const handler = (signal: NodeJS.Signals): void => {
    for (const name of SHUTDOWN_SIGNALS) process.removeListener(name, handler);
    void shutdown(signal);
  };

  async function shutdown(signal: NodeJS.Signals): Promise<void> {
    logger.log({ signal, drainMs }, '收到結束訊號，開始排空');
    state.startDraining(drainMs);
    if (drainMs > 0) await delay(drainMs);
    try {
      // 沒有 hook 用到訊號參數；`INestApplication.close()` 的型別也不收
      await app.close();
    } catch (error) {
      logger.error({ err: error }, '關閉時發生錯誤');
      process.exitCode = 1;
    }
    // 監聽已移除：以同一個訊號結束，結束碼與預設行為相同（同 Nest 的 enableShutdownHooks）
    process.kill(process.pid, signal);
  }

  for (const name of SHUTDOWN_SIGNALS) process.on(name, handler);
}
