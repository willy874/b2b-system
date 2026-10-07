import { Global, Injectable, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { createLimiter, LimiterBusyError } from '@/core/concurrency';
import type { Limiter } from '@/core/concurrency';
import type { Env } from '@/core/config';
import { AppException } from '@/core/errors';

import { hashPassword, verifyAgainstDummy, verifyPassword } from './password';
import type { Argon2Options } from './password';

/** 名額已滿時建議的等待秒數（`Retry-After`）：一次驗證只要數十毫秒，兩秒後通常就有名額。 */
const BUSY_RETRY_AFTER_SECONDS = 2;

/**
 * 所有 argon2 的雜湊與驗證（登入、假驗證、變更／重設／啟用密碼，租戶與平台）都經過這裡
 * （docs/architecture/backend/04-auth.md §4.1）：
 *
 * - 參數一律讀 `ARGON2_*`（平台端原本用的是預設值）。
 * - 程序內的並行上限 `ARGON2_MAX_CONCURRENCY`、等待上限 `ARGON2_MAX_QUEUE`、等待逾時 `ARGON2_QUEUE_TIMEOUT_MS`：
 *   argon2 跑在 libuv 的 threadpool，與 sharp、DNS、檔案 I/O 共用；一陣登入尖峰不能把它們全部卡住。
 *   名額滿了快速失敗（`503 AUTH_BUSY`），不讓請求在 threadpool 裡無限排隊。
 */
@Injectable()
export class PasswordHasher {
  private readonly limit: Limiter;
  private readonly options: Argon2Options;

  constructor(config: ConfigService<Env, true>) {
    this.options = {
      memoryCost: config.get('ARGON2_MEMORY_COST', { infer: true }),
      timeCost: config.get('ARGON2_TIME_COST', { infer: true }),
    };
    this.limit = createLimiter({
      name: 'argon2',
      concurrency: config.get('ARGON2_MAX_CONCURRENCY', { infer: true }),
      maxQueue: config.get('ARGON2_MAX_QUEUE', { infer: true }),
      queueTimeoutMs: config.get('ARGON2_QUEUE_TIMEOUT_MS', { infer: true }),
    });
  }

  hash(password: string): Promise<string> {
    return this.run(() => hashPassword(password, this.options));
  }

  verify(passwordHash: string, password: string): Promise<boolean> {
    return this.run(() => verifyPassword(passwordHash, password));
  }

  /** 帳號不存在（或沒有密碼）時：以同樣的參數驗一次，耗時與真正的驗證一致（時序攻擊防護）。 */
  verifyAgainstDummy(password: string): Promise<false> {
    return this.run(() => verifyAgainstDummy(password, this.options));
  }

  private async run<T>(task: () => Promise<T>): Promise<T> {
    try {
      return await this.limit(task);
    } catch (error) {
      if (error instanceof LimiterBusyError) {
        throw new AppException('AUTH_BUSY', { retryAfterSeconds: BUSY_RETRY_AFTER_SECONDS });
      }
      throw error;
    }
  }
}

/**
 * 全域：租戶的登入（AuthModule）、帳號管理（UserModule）與平台管理者（PlatformAdminModule，葉節點）
 * 共用 **同一個** 並行上限——分開就等於上限乘上模組數。
 */
@Global()
@Module({ providers: [PasswordHasher], exports: [PasswordHasher] })
export class PasswordHasherModule {}
