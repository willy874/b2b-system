import { useSyncExternalStore } from 'react';

import { sessionStore } from './SessionStore';
import type { SessionStore } from './SessionStore';

/**
 * 登入 / 登出 / 續期後會重新渲染，讓 profile query 的 `enabled` 能即時反應。
 * 預設看主後端；其他後端的畫面傳入自己的 session。
 */
export function useHasSession(session: SessionStore = sessionStore): boolean {
  return useSyncExternalStore(
    (listener) => session.subscribe(listener),
    () => session.hasSession(),
    () => false,
  );
}
