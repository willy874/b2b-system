import { sessionStore } from '@b2b-system/web-core/auth';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createUploadSources, UPLOAD_SOURCE_MAX_AGE_MS } from '../uploadSources';

afterEach(() => {
  sessionStore.clear();
});

describe('createUploadSources（每個 feature 自己的上傳暫存區）', () => {
  it('prune 只清掉放進來超過 UPLOAD_SOURCE_MAX_AGE_MS 的檔案', async () => {
    let time = 0;
    const sources = createUploadSources('test-prune', { indexedDB: undefined, now: () => time });
    await sources.store.put('old', new Blob(['1']));
    time = UPLOAD_SOURCE_MAX_AGE_MS;
    await sources.store.put('new', new Blob(['2']));
    time = UPLOAD_SOURCE_MAX_AGE_MS + 1;

    await sources.prune();

    await expect(sources.store.get('old')).resolves.toBeUndefined();
    await expect(sources.store.get('new')).resolves.toBeInstanceOf(Blob);
  });

  it('clearOnSessionEnd：主 session 結束時清掉自己的暫存，不影響其他 feature 的', async () => {
    const mine = createUploadSources('test-mine', { indexedDB: undefined });
    const others = createUploadSources('test-others', { indexedDB: undefined });
    const off = mine.clearOnSessionEnd();
    await mine.store.put('a', new Blob(['a']));
    await others.store.put('b', new Blob(['b']));
    sessionStore.setTokens({ accessToken: 'token', expiresIn: 300 });

    sessionStore.endSession('logout');

    await vi.waitFor(async () => {
      await expect(mine.store.get('a')).resolves.toBeUndefined();
    });
    await expect(others.store.get('b')).resolves.toBeInstanceOf(Blob);
    off();
  });

  it('解除訂閱之後 session 結束不再清除（feature 被停用時）', async () => {
    const sources = createUploadSources('test-off', { indexedDB: undefined });
    const off = sources.clearOnSessionEnd();
    off();
    await sources.store.put('a', new Blob(['a']));
    sessionStore.setTokens({ accessToken: 'token', expiresIn: 300 });

    sessionStore.endSession('logout');

    await expect(sources.store.get('a')).resolves.toBeInstanceOf(Blob);
  });
});
