import { Injectable } from '@nestjs/common';
import type { OnModuleDestroy } from '@nestjs/common';

/** 一個計數 key 在目前時間窗內的狀態。 */
export interface RateLimitRecord {
  /** 時間窗內的次數。 */
  count: number;
  /** 時間窗結束的時刻（epoch 毫秒）：之後歸零。 */
  resetAt: number;
  /** 最近一次計數的時刻（epoch 毫秒）：登入的漸進延遲以它起算。 */
  lastAt: number;
}

/**
 * 速率限制與登入延遲的計數（docs/architecture/backend/03-api-conventions.md §8）。固定時間窗：第一次計數時開窗，
 * 窗結束後下一次計數重新開始。
 *
 * 規則（計什麼、上限多少）在呼叫端；這裡只負責「存」。目前是程序內的記憶體實作：多實例時上限會變成 N 倍，
 * 換成共享的實作（Postgres，docs/features/multi-instance.md）只要換掉這個 provider，規則不必改。
 */
export abstract class RateLimitStore {
  /** 計一次並回傳計數後的狀態。 */
  abstract hit(key: string, windowMs: number): Promise<RateLimitRecord>;
  /** 目前的狀態，不計數；沒有或已過期回 `undefined`。 */
  abstract peek(key: string): Promise<RateLimitRecord | undefined>;
  /** 清掉這個 key（例：登入成功後清除錯誤次數）。 */
  abstract reset(key: string): Promise<void>;
}

/** 過期項目的清理間隔：不必每次計數都掃。 */
const PRUNE_INTERVAL_MS = 60_000;

@Injectable()
export class MemoryRateLimitStore extends RateLimitStore implements OnModuleDestroy {
  private readonly records = new Map<string, RateLimitRecord>();
  private readonly timer = setInterval(() => this.prune(), PRUNE_INTERVAL_MS);

  constructor() {
    super();
    // 不讓清理的計時器擋住程序結束
    this.timer.unref();
  }

  hit(key: string, windowMs: number): Promise<RateLimitRecord> {
    const now = Date.now();
    const current = this.records.get(key);
    const record =
      current && current.resetAt > now
        ? { ...current, count: current.count + 1, lastAt: now }
        : { count: 1, resetAt: now + windowMs, lastAt: now };
    this.records.set(key, record);
    return Promise.resolve(record);
  }

  peek(key: string): Promise<RateLimitRecord | undefined> {
    const record = this.records.get(key);
    return Promise.resolve(record && record.resetAt > Date.now() ? record : undefined);
  }

  reset(key: string): Promise<void> {
    this.records.delete(key);
    return Promise.resolve();
  }

  onModuleDestroy(): void {
    clearInterval(this.timer);
  }

  private prune(): void {
    const now = Date.now();
    for (const [key, record] of this.records) {
      if (record.resetAt <= now) this.records.delete(key);
    }
  }
}
