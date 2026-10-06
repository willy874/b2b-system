import { useCallback, useSyncExternalStore } from 'react';

import { sessionStore } from './SessionStore';
import type { SessionStore } from './SessionStore';

/**
 * 登入 / 登出 / 續期後會重新渲染，讓 profile query 的 `enabled` 能即時反應。
 * 預設看主後端；其他後端的畫面傳入自己的 session。
 */
export function useHasSession(session: SessionStore = sessionStore): boolean {
  // subscribe 每次換新的話，React 會在每次 render 都退訂再重新訂閱
  const subscribe = useCallback((listener: () => void) => session.subscribe(listener), [session]);
  return useSyncExternalStore(
    subscribe,
    () => session.hasSession(),
    () => false,
  );
}
