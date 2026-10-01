import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { collectRegistrations } from '@/shared/registry';
import { initTestI18n } from '@/test/i18n';

import {
  addResourceBundle,
  loadLocaleScope,
  resetLocaleRegistry,
  subscribeLocaleScopeLoaded,
} from '../i18n';

const bundle = (importer: () => Promise<{ default: Record<string, unknown> }>) => ({
  'zh-TW': { translation: importer },
});

describe('語系包的登記（docs/adr/0021-runtime-feature-activation.md D4）', () => {
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
