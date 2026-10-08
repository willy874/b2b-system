import { Injectable } from '@nestjs/common';

/** 開始排空時通知的對象；`drainMs` 是排空期的長度（0 = 不排空，連線由關閉流程直接斷）。 */
export type DrainListener = (drainMs: number) => void;

/**
 * 程序是否正在結束（docs/architecture/01-system.md §7 D13）。收到 `SIGTERM` 之後先進入排空：readiness 回 503，
 * 讓 LB／Ingress 把這個程序移出，等 `SHUTDOWN_DRAIN_SECONDS` 再關 HTTP server 與各模組。
 */
@Injectable()
export class ShutdownState {
  private isDrainingNow = false;
  private readonly listeners: DrainListener[] = [];

  get draining(): boolean {
    return this.isDrainingNow;
  }

  /** 開始排空時要做的事（例：WebSocket 在排空期內分批斷線）。在 `onModuleInit` 或 gateway 初始化時登記。 */
  onDrain(listener: DrainListener): void {
    this.listeners.push(listener);
  }

  /** 進入排空；重複呼叫只算第一次。 */
  startDraining(drainMs: number): void {
    if (this.isDrainingNow) return;
    this.isDrainingNow = true;
    for (const listener of this.listeners) listener(drainMs);
  }
}
