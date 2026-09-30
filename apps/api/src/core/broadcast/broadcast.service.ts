import { Inject, Injectable, Logger } from '@nestjs/common';
import type { OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';

import { PLATFORM_SQL } from '../database';
import type { PlatformSql } from '../database';

/** 一個頻道的訂閱者。 */
export interface BroadcastSubscriber {
  /** 收到訊息（含自己送出的：各程序都收得到，處理要冪等）。 */
  onMessage(payload: string): void | Promise<void>;
  /**
   * 監聽的連線斷線後重新接上：中間的訊息可能漏了，訂閱者應該把自己的快取整個丟掉。
   * 第一次接上不呼叫。
   */
  onReconnect?(): void | Promise<void>;
}

/** `NOTIFY` 的 payload 上限是 8000 位元組：只送 key，不送資料。 */
const MAX_PAYLOAD_BYTES = 8000;

/**
 * 程序之間的失效廣播（docs/adr/0024-relationship-based-access-control.md D7、docs/features/multi-instance.md）：
 * 平台 DB 上的 `LISTEN`／`NOTIFY`。每個程序只有一條監聽的連線（postgres.js 的 `listen` 自己維持、斷線重連），
 * 與租戶的數量無關；各租戶 DB 的變更由程式在交易提交後送到這裡。
 *
 * 不保證送達：提交之後、送出之前程序結束就漏了，訂閱者要有 TTL 之類的最後防線。
 */
@Injectable()
export class BroadcastService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(BroadcastService.name);
  private readonly subscribers = new Map<string, BroadcastSubscriber[]>();
  private readonly unlisteners: Array<() => Promise<void>> = [];

  constructor(@Inject(PLATFORM_SQL) private readonly sql: PlatformSql) {}

  /** 在 `onModuleInit` 訂閱；程序啟動完成（`onApplicationBootstrap`）才開始監聽。 */
  subscribe(channel: string, subscriber: BroadcastSubscriber): void {
    const list = this.subscribers.get(channel) ?? [];
    list.push(subscriber);
    this.subscribers.set(channel, list);
  }

  /** 送出失敗只記錄：廣播是加速，不是正確性的來源。 */
  async publish(channel: string, payload: string): Promise<void> {
    if (Buffer.byteLength(payload) >= MAX_PAYLOAD_BYTES) {
      throw new Error(`廣播的 payload 超過 ${MAX_PAYLOAD_BYTES} 位元組：${channel}`);
    }
    try {
      await this.sql.notify(channel, payload);
    } catch (error) {
      this.logger.error({ err: error, channel }, '送出廣播失敗');
    }
  }

  async onApplicationBootstrap(): Promise<void> {
    for (const [channel, list] of this.subscribers) {
      let connected = false;
      // oxlint-disable-next-line no-await-in-loop -- 頻道數量是常數，依序開始監聽
      const meta = await this.sql.listen(
        channel,
        (payload) => void this.dispatch(channel, list, (s) => s.onMessage(payload)),
        () => {
          // postgres.js 在第一次與每次重連後都呼叫；只有重連要通知訂閱者
          if (connected) {
            this.logger.warn({ channel }, '廣播的監聽連線已重新接上，訂閱者丟棄快取');
            void this.dispatch(channel, list, (s) => s.onReconnect?.());
          }
          connected = true;
        },
      );
      this.unlisteners.push(() => meta.unlisten());
    }
  }

  async onApplicationShutdown(): Promise<void> {
    await Promise.allSettled(this.unlisteners.map((unlisten) => unlisten()));
  }

  private async dispatch(
    channel: string,
    list: readonly BroadcastSubscriber[],
    call: (subscriber: BroadcastSubscriber) => void | Promise<void>,
  ): Promise<void> {
    for (const subscriber of list) {
      try {
        // oxlint-disable-next-line no-await-in-loop -- 同一個頻道的訂閱者依序處理
        await call(subscriber);
      } catch (error) {
        this.logger.error({ err: error, channel }, '處理廣播失敗');
      }
    }
  }
}
