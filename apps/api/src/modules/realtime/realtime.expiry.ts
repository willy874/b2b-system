import { ServerEvent } from '@b2b-system/realtime';
import { Injectable, OnModuleDestroy } from '@nestjs/common';

import type { RealtimeSocket } from './realtime.types';

/** `setTimeout` 的上限（約 24.8 天）；超過會被 Node 當成 1 ms。 */
const MAX_TIMEOUT_MS = 2 ** 31 - 1;

/**
 * 連線的授權期限 = 最後一次驗過的 token 的 `exp`（docs/architecture/backend/08-realtime.md §3.4）。
 * 到期還沒 `session.renew` → 推 `session.expired` 並斷線。每個節點只管自己的連線。
 */
@Injectable()
export class RealtimeExpiry implements OnModuleDestroy {
  private readonly timers = new Map<string, NodeJS.Timeout>();

  /** 依 `socket.data.expiresAt` 排程；重複呼叫會取代前一個計時器（續期）。 */
  schedule(socket: RealtimeSocket): void {
    this.cancel(socket);
    const delay = Math.min(Math.max(0, socket.data.expiresAt - Date.now()), MAX_TIMEOUT_MS);
    const timer = setTimeout(() => {
      this.timers.delete(socket.id);
      socket.emit(ServerEvent.SESSION_EXPIRED);
      socket.disconnect(true);
    }, delay);
    // 計時器不該讓程序在關機時多撐到 token 到期
    timer.unref();
    this.timers.set(socket.id, timer);
  }

  cancel(socket: RealtimeSocket): void {
    const timer = this.timers.get(socket.id);
    if (!timer) return;
    clearTimeout(timer);
    this.timers.delete(socket.id);
  }

  onModuleDestroy(): void {
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
  }
}
