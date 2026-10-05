import { describe, expect, it } from 'vitest';

import { mergeLocaleImporters, mergeLocaleResources } from '../coreLocales';

describe('mergeLocaleResources', () => {
  it('巢狀物件逐層合併，後面的覆寫前面的', () => {
    expect(
      mergeLocaleResources(
        { common: { save: '儲存', cancel: '取消' }, error: { A: 'a' } },
        { common: { save: '存檔' }, menu: { home: '首頁' } },
      ),
    ).toEqual({
      common: { save: '存檔', cancel: '取消' },
      error: { A: 'a' },
      menu: { home: '首頁' },
    });
  });

  it('不改動傳入的物件', () => {
    const base = { common: { save: '儲存' } };
    mergeLocaleResources(base, { common: { save: '存檔' } });
    expect(base).toEqual({ common: { save: '儲存' } });
  });
});

describe('mergeLocaleImporters', () => {
  it('並行載入後依序合併', async () => {
    const load = mergeLocaleImporters(
      async () => ({ default: { common: { a: '1', b: '1' } } }),
      async () => ({ default: { common: { b: '2' } } }),
    );
    await expect(load()).resolves.toEqual({ default: { common: { a: '1', b: '2' } } });
  });
});
