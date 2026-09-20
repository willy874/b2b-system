import { useSyncExternalStore } from 'react';

import { sessionStore } from './SessionStore';

/** 登入 / 登出 / 續期後會重新渲染，讓 profile query 的 `enabled` 能即時反應。 */
export function useHasSession(): boolean {
  return useSyncExternalStore(
    (listener) => sessionStore.subscribe(listener),
    () => sessionStore.hasSession(),
    () => false,
  );
}
