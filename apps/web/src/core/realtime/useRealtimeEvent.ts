import { useEffect, useLayoutEffect, useRef } from 'react';

import type { ServerEvent, ServerToClientEvents } from '@/shared/realtime';

import { getActiveRealtimeClient } from './activeClient';

/**
 * Feature 訂閱伺服器事件的唯一入口（docs/architecture/frontend/11-realtime.md §8）。
 *
 *   useRealtimeEvent(ServerEvent.SOMETHING, (payload) => { … });
 *
 * - 事件名稱與 payload 型別來自 `@/shared/realtime`，不在 feature 裡寫字串。
 * - 一般資料更新 **不需要** 訂閱：宣告在依賴圖裡就會自動失效；只有「不是 query 的東西」才用這個。
 * - 推播停用（mock 模式）時什麼都不做；功能不能只靠推播。
 * - `handler` 每次 render 可以是新的函式，不會因此重新訂閱。
 */
export function useRealtimeEvent<E extends ServerEvent>(
  event: E,
  handler: ServerToClientEvents[E],
): void {
  const handlerRef = useRef(handler);
  useLayoutEffect(() => {
    handlerRef.current = handler;
  });

  useEffect(() => {
    const client = getActiveRealtimeClient();
    if (!client) return undefined;
    const listener = ((...args: unknown[]) =>
      (handlerRef.current as (...a: unknown[]) => void)(...args)) as ServerToClientEvents[E];
    return client.onServerEvent(event, listener);
  }, [event]);
}
