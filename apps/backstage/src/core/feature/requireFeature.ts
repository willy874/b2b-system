import { sessionStore } from '@b2b-system/web-core/auth';
import { notFound } from '@tanstack/react-router';

import { featureStore } from './store';
import type { FeatureStatus } from './store';

/** 還沒有定論：清單還沒套用，或正在安裝。 */
function isSettled(id: string): boolean {
  const { resolved, statuses } = featureStore.getState();
  return resolved && statuses.get(id) !== 'installing';
}

/**
 * 等到這個 feature 有定論（清單已套用、不在安裝中）。沒有 session 時不等：
 * 啟用清單要登入後才拿得到，導向登入頁的工作交給 `SessionWatcher`（web-core/shell，`app/App.tsx` 掛上）。
 */
export function waitForFeature(id: string): Promise<FeatureStatus | undefined> {
  const current = () => featureStore.getState().statuses.get(id);
  if (!sessionStore.hasSession() || isSettled(id)) return Promise.resolve(current());

  return new Promise((resolve) => {
    const finish = () => {
      stopStore();
      stopSession();
      resolve(current());
    };
    const stopStore = featureStore.subscribe(() => {
      if (isSettled(id)) finish();
    });
    const stopSession = sessionStore.events.on('ended', finish);
  });
}

/**
 * 可啟用 feature 最上層 route 的 `beforeLoad`（docs/architecture/frontend/02-plugin-system.md §9.2 D6）：
 * 已啟用 → 通過；安裝中或清單還沒到 → 等待；未啟用 → 404；安裝失敗 → 錯誤頁。
 *
 * 等待很重要：直接貼網址進來時清單可能還在路上，而 route 的 loader（語系包）必須在 feature 安裝 **之後** 才跑。
 */
export function requireFeature(id: string): () => Promise<void> {
  return async () => {
    if (!sessionStore.hasSession()) return;
    const status = await waitForFeature(id);
    // 等待期間 session 結束：交給 SessionWatcher 導向登入頁
    if (!sessionStore.hasSession()) return;
    if (status === 'ready') return;
    if (status === 'failed') throw new Error(`feature "${id}" 安裝失敗`);
    throw notFound();
  };
}
