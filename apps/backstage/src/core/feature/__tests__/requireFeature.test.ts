import { sessionStore } from '@b2b-system/web-core/auth';
import { isNotFound } from '@tanstack/react-router';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { requireFeature } from '../requireFeature';
import { featureStore, resetFeatureStore } from '../store';

function settle(status: 'ready' | 'disabled' | 'failed' | 'installing', resolved = true) {
  featureStore.setState({ resolved, statuses: new Map([['file', status]]) });
}

describe('requireFeature（docs/architecture/frontend/02-plugin-system.md §9.2 D6）', () => {
  beforeEach(() => {
    resetFeatureStore();
    sessionStore.clear();
    sessionStore.setTokens({ accessToken: 'token', expiresIn: 300 });
  });

  afterEach(() => sessionStore.clear());

  it('已安裝 → 通過', async () => {
    settle('ready');
    await expect(requireFeature('file')()).resolves.toBeUndefined();
  });

  it('未啟用 → notFound', async () => {
    settle('disabled');
    const error: unknown = await requireFeature('file')().catch((caught: unknown) => caught);
    expect(isNotFound(error)).toBe(true);
  });

  it('安裝失敗 → 丟錯（交給路由的錯誤頁）', async () => {
    settle('failed');
    await expect(requireFeature('file')()).rejects.toThrow('安裝失敗');
  });

  it('清單還沒到時等待，安裝完成後通過', async () => {
    let settled = false;
    const guard = requireFeature('file')().then(() => {
      settled = true;
    });
    settle('installing', false);
    await Promise.resolve();
    expect(settled).toBe(false);

    settle('ready');
    await guard;
    expect(settled).toBe(true);
  });

  it('沒有 session 時不等待也不擋（導向登入頁交給 SessionWatcher）', async () => {
    sessionStore.clear();
    await expect(requireFeature('file')()).resolves.toBeUndefined();
  });

  it('等待期間 session 結束 → 放行，不丟 404', async () => {
    const guard = requireFeature('file')();
    sessionStore.endSession('logout');
    await expect(guard).resolves.toBeUndefined();
  });
});
