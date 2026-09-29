import type { RealtimeClient } from './RealtimeClient';
import type { RealtimeCoordinator } from './RealtimeCoordinator';

let active: RealtimeClient | undefined;
let coordinator: RealtimeCoordinator | undefined;

/**
 * 登記目前 app 使用的連線與協調者（由 `plugins/app/realtime.ts` 呼叫；傳 `undefined` 代表推播停用）。
 * 以模組層級的登記讓 `core/cache`、`useRealtimeEvent` 不必認識 plugin 或 AppContext。
 */
export function setActiveRealtimeClient(
  client: RealtimeClient | undefined,
  activeCoordinator?: RealtimeCoordinator,
): void {
  active = client;
  coordinator = client ? activeCoordinator : undefined;
}

/** 本分頁的連線物件（只有 leader 分頁真的連線）；推播停用（mock 模式）時為 `undefined`。 */
export function getActiveRealtimeClient(): RealtimeClient | undefined {
  return active;
}

/**
 * 推播是否可用：本分頁是 leader 且連線中，或 leader 分頁回報連線中。
 * 可用時其他分頁會經 leader 收到同一筆變更，`queryClient.broadcastInvalidation` 就不再經本機頻道廣播
 * （docs/architecture/frontend/11-realtime.md §4.2）。沒有協調者時退回看本分頁的連線。
 */
export function isRealtimeAvailable(): boolean {
  if (coordinator) return coordinator.isAvailable();
  return active?.isConnected ?? false;
}
