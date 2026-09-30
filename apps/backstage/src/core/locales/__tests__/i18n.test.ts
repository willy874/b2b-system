import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { collectRegistrations } from '@/shared/registry';
import { initTestI18n } from '@/test/i18n';

import { addResourceBundle, loadLocaleScope, resetLocaleRegistry } from '../i18n';

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
