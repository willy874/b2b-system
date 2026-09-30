import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type { Env } from '../config';

export type AuthzShadowMode = 'off' | 'log' | 'throw';

/** 影子比對發現新舊不一致（只在 `AUTHZ_SHADOW=throw` 時丟出）。 */
export class AuthzShadowMismatchError extends Error {
  constructor(
    readonly label: string,
    readonly details: unknown,
  ) {
    super(`權限圖的影子比對不一致（${label}）：${JSON.stringify(details)}`);
    this.name = 'AuthzShadowMismatchError';
  }
}

/**
 * G1～G2 的影子比對（docs/adr/0024-relationship-based-access-control.md）：新舊兩套解析的結果交給這裡比較。
 * 正式環境預設關閉；測試環境不一致就丟錯，讓既有的整合測試直接成為新舊一致的驗收。
 */
@Injectable()
export class AuthzShadow {
  private readonly logger = new Logger(AuthzShadow.name);
  readonly mode: AuthzShadowMode;

  constructor(config: ConfigService<Env, true>) {
    const configured = config.get('AUTHZ_SHADOW', { infer: true });
    const nodeEnv = config.get('NODE_ENV', { infer: true });
    this.mode =
      configured ?? (nodeEnv === 'test' ? 'throw' : nodeEnv === 'development' ? 'log' : 'off');
  }

  get enabled(): boolean {
    return this.mode !== 'off';
  }

  /** `diff` 為空表示一致；否則依模式記錄或丟錯。 */
  report(label: string, diff: Record<string, unknown> | null): void {
    if (!diff) return;
    this.logger.error({ label, ...diff }, '權限圖的影子比對不一致');
    if (this.mode === 'throw') throw new AuthzShadowMismatchError(label, diff);
  }
}

/** 兩個集合的差異；一致時是 null。 */
export function setDiff<T>(
  legacy: ReadonlySet<T>,
  engine: ReadonlySet<T>,
): { onlyLegacy: T[]; onlyEngine: T[] } | null {
  const onlyLegacy = [...legacy].filter((item) => !engine.has(item));
  const onlyEngine = [...engine].filter((item) => !legacy.has(item));
  return onlyLegacy.length || onlyEngine.length ? { onlyLegacy, onlyEngine } : null;
}
