import { collectRegistrations } from '@b2b-system/web-shared/registry';
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { initTestI18n } from '../../testing/i18n';
import {
  addResourceBundle,
  changeLanguage,
  i18n,
  loadLocaleScope,
  resetLocaleRegistry,
  subscribeLocaleScopeLoaded,
} from '../i18n';
import { useTranslation } from '../useTranslation';

const bundle = (importer: () => Promise<{ default: Record<string, unknown> }>) => ({
  'zh-TW': { translation: importer },
});

describe('語系包的登記（docs/architecture/frontend/02-plugin-system.md §9.2 D4）', () => {
  beforeAll(() => initTestI18n());
  beforeEach(() => resetLocaleRegistry());

  it('scope 還沒登記時不記成已載入：feature 安裝後仍會下載', async () => {
    const importer = vi.fn(() => Promise.resolve({ default: { demo: { title: 'Demo' } } }));
    await loadLocaleScope('feature-demo', 'zh-TW');
    addResourceBundle(bundle(importer), { scope: 'feature-demo' });
    await loadLocaleScope('feature-demo', 'zh-TW');

    expect(importer).toHaveBeenCalledOnce();
  });

  it('登記前被要求過的 scope：登記的當下補載並通知訂閱者，之後的要求不重複下載', async () => {
    const importer = vi.fn(() => Promise.resolve({ default: { late: { title: '晚到' } } }));
    const listener = vi.fn();
    subscribeLocaleScopeLoaded(listener);
    await loadLocaleScope('feature-late', 'zh-TW');
    expect(listener).not.toHaveBeenCalled();

    addResourceBundle(bundle(importer), { scope: 'feature-late' });
    // 補載還在進行中時再要求：沿用同一次下載
    await loadLocaleScope('feature-late', 'zh-TW');

    expect(importer).toHaveBeenCalledOnce();
    expect(listener).toHaveBeenCalledWith('feature-late', 'zh-TW');
  });

  it('沒有被要求過的 scope：登記時不下載（仍由 route loader 觸發）', () => {
    const importer = vi.fn(() => Promise.resolve({ default: {} }));
    addResourceBundle(bundle(importer), { scope: 'feature-lazy' });
    expect(importer).not.toHaveBeenCalled();
  });

  it('同時要求同一包 → 只下載一次', async () => {
    const importer = vi.fn(() => Promise.resolve({ default: {} }));
    addResourceBundle(bundle(importer), { scope: 'feature-demo' });
    await Promise.all([
      loadLocaleScope('feature-demo', 'zh-TW'),
      loadLocaleScope('feature-demo', 'zh-TW'),
    ]);
    expect(importer).toHaveBeenCalledOnce();
  });

  it('在收集範圍內登記的語系包，撤回後不再下載', async () => {
    const importer = vi.fn(() => Promise.resolve({ default: {} }));
    const { dispose } = collectRegistrations(() =>
      addResourceBundle(bundle(importer), { scope: 'feature-demo' }),
    );

    dispose();
    await loadLocaleScope('feature-demo', 'zh-TW');
    expect(importer).not.toHaveBeenCalled();
  });
});

describe('useTranslation 的重繪次數（docs/architecture/frontend/08-i18n.md §2.2）', () => {
  const SCOPES = ['feature-a', 'feature-b', 'feature-c'];
  /** en-US 的包由測試逐一放行：每一包在不同的時間點下載完成（各自一個 act），React 不會把重繪合併。 */
  let release: Map<string, () => void>;

  function registerScope(scope: string) {
    addResourceBundle(
      {
        'zh-TW': {
          translation: () => Promise.resolve({ default: { [scope]: { title: '標題' } } }),
        },
        'en-US': {
          translation: () =>
            new Promise((resolve) => {
              release.set(scope, () => resolve({ default: { [scope]: { title: 'Title' } } }));
            }),
        },
      },
      { scope },
    );
  }

  function renderCounted() {
    let renders = 0;
    renderHook(() => {
      renders += 1;
      return useTranslation();
    });
    return () => renders;
  }

  /** 放行一包並讓 React 處理它觸發的更新。 */
  async function releaseScope(scope: string) {
    await act(async () => {
      release.get(scope)?.();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }

  beforeAll(() => initTestI18n());
  beforeEach(async () => {
    resetLocaleRegistry();
    release = new Map();
    for (const scope of SCOPES) {
      registerScope(scope);
      await loadLocaleScope(scope, 'zh-TW');
    }
  });
  afterEach(async () => {
    await act(() => i18n.changeLanguage('zh-TW'));
  });

  it('切換語系：補載 N 個 scope 的新語系版本時不重繪，最後的 languageChanged 才重繪 1 次', async () => {
    const renders = renderCounted();
    const before = renders();
    const switching = changeLanguage('en-US');
    // 最後一包到了之後 changeLanguage 才切換 i18next 的語系：前面幾包都不該重繪
    for (const scope of SCOPES.slice(0, -1)) await releaseScope(scope);
    expect(renders() - before).toBe(0);

    await releaseScope(SCOPES.at(-1) as string);
    await act(() => switching);
    expect(i18n.language).toBe('en-US');
    expect(renders() - before).toBe(1);
  });

  it('載入目前語系的新 scope：已經掛上的元件重繪一次（晚到的 feature 需要）', async () => {
    const renders = renderCounted();
    const before = renders();
    registerScope('feature-late');
    await act(() => loadLocaleScope('feature-late', 'zh-TW'));
    expect(renders() - before).toBe(1);
  });

  it('載入的不是目前語系：不重繪', async () => {
    const renders = renderCounted();
    const before = renders();
    const loading = loadLocaleScope('feature-a', 'en-US');
    await releaseScope('feature-a');
    await act(() => loading);
    expect(renders() - before).toBe(0);
  });
});
