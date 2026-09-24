import type { ServerToClientEvents } from '@game-editor/realtime';
import { Injectable } from '@nestjs/common';

import type { RealtimeServer } from './realtime.types';

type ServerEventName = keyof ServerToClientEvents;

/**
 * 對「已連線的客戶端」做事的唯一出口（docs/architecture/backend/08-realtime.md §2）。
 * `RealtimeListener`、`RealtimeAudience` 只依賴它，以 room 表達受眾，不認識底層的傳輸層；
 * 換掉 Socket.io 時只換實作。abstract class 同時當 DI token。
 *
 * 只在 `modules/realtime` 內使用；業務模組發佈領域事件，不注入它（ADR-0008）。
 */
export abstract class RealtimePublisher {
  /** 推給這些 room 的聯集，同一條連線只收到一次；沒有 room 時不推。 */
  abstract emit<E extends ServerEventName>(
    rooms: string | readonly string[],
    event: E,
    ...args: Parameters<ServerToClientEvents[E]>
  ): void;

  /** room 內在本節點的連線數（§10.3：跨節點之後要改看 adapter）。 */
  abstract countConnections(room: string): number;

  /** 把 `room` 內的所有連線移出 `leave`、再加入 `join`。 */
  abstract moveRooms(room: string, leave: readonly string[], join: readonly string[]): void;

  /** 斷掉 room 內的所有連線；之前 `emit` 的事件會先送達。 */
  abstract disconnect(room: string): void;
}

/**
 * `RealtimePublisher` 的 Socket.io 實作。伺服器物件由 gateway 在 `afterInit` 交進來：
 * 反過來注入 gateway 會形成 gateway → audience → publisher → gateway 的循環。
 * 交進來之前（啟動中）所有操作都是空操作。
 */
@Injectable()
export class SocketIoRealtimePublisher extends RealtimePublisher {
  private server: RealtimeServer | undefined;

  attach(server: RealtimeServer): void {
    this.server = server;
  }

  emit<E extends ServerEventName>(
    rooms: string | readonly string[],
    event: E,
    ...args: Parameters<ServerToClientEvents[E]>
  ): void {
    const targets = typeof rooms === 'string' ? [rooms] : [...rooms];
    // Socket.io 的 `to([])` 會廣播給「所有」連線
    if (!this.server || !targets.length) return;
    this.server.to(targets).emit(event, ...args);
  }

  countConnections(room: string): number {
    return this.server?.sockets.adapter.rooms.get(room)?.size ?? 0;
  }

  moveRooms(room: string, leave: readonly string[], join: readonly string[]): void {
    if (!this.server) return;
    const sockets = this.server.in(room);
    sockets.socketsLeave([...leave]);
    sockets.socketsJoin([...join]);
  }

  disconnect(room: string): void {
    // engine.io 會等寫入緩衝送完才關閉，所以之前 emit 的事件會先送到
    this.server?.in(room).disconnectSockets(true);
  }
}
