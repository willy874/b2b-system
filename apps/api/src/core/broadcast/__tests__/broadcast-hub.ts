import type { PlatformSql } from '../../database';
import { BroadcastService } from '../broadcast.service';

type Listener = (payload: string) => void;

/**
 * 單元測試用的「平台 DB」：在記憶體裡模擬 `LISTEN`／`NOTIFY`，讓同一個測試裡的多個 `BroadcastService`
 * 扮演不同的程序。送出時同步交給每個監聽者（含自己），與 Postgres 一樣。
 */
export class BroadcastHub {
  private readonly listeners = new Map<string, Set<Listener>>();
  private readonly reconnects = new Set<() => void>();
  /** 每一則送出的 `[channel, payload]`，給斷言用。 */
  readonly sent: Array<[string, string]> = [];

  /** 一個新的程序：回傳的 service 還沒開始監聽，依序呼叫 `onModuleInit` 系列與 `start()`。 */
  instance(): BroadcastService {
    const sql = {
      notify: async (channel: string, payload: string) => {
        this.sent.push([channel, payload]);
        for (const listener of this.listeners.get(channel) ?? []) listener(payload);
      },
      listen: async (channel: string, onMessage: Listener, onListen: () => void) => {
        const set = this.listeners.get(channel) ?? new Set<Listener>();
        set.add(onMessage);
        this.listeners.set(channel, set);
        onListen();
        this.reconnects.add(onListen);
        return { unlisten: async () => void set.delete(onMessage) };
      },
    };
    return new BroadcastService(sql as unknown as PlatformSql);
  }

  /** 模擬監聽連線斷線後重新接上。 */
  reconnect(): void {
    for (const onListen of this.reconnects) onListen();
  }

  /** 送出的訊息（拆掉 `channel()` 的信封）。 */
  messages(channel: string): unknown[] {
    return this.sent
      .filter(([name]) => name === channel)
      .map(([, payload]) => (JSON.parse(payload) as { m: unknown }).m);
  }
}

/** 等廣播的分派（非同步）與合併送出（microtask）跑完。 */
export function flushBroadcast(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}
