import type { ClientToServerEvents, ServerToClientEvents } from '@b2b-system/realtime';
import type { Server, Socket } from 'socket.io';

import type { AuthenticatedSocketData } from '@/common/types';

export interface RealtimeSocketData extends AuthenticatedSocketData {
  connectedAt: number;
}

/** 單一執行個體沒有節點間事件（docs/architecture/backend/08-realtime.md §10.3）。 */
type InterServerEvents = Record<string, never>;

export type RealtimeServer = Server<
  ClientToServerEvents,
  ServerToClientEvents,
  InterServerEvents,
  RealtimeSocketData
>;

export type RealtimeSocket = Socket<
  ClientToServerEvents,
  ServerToClientEvents,
  InterServerEvents,
  RealtimeSocketData
>;
