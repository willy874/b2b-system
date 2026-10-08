import { getHeaderTools, resetHeaderToolRegistry } from '@b2b-system/web-core/toolbar';
import type * as Constants from '@b2b-system/web-shared/constants';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { registerBuiltinHeaderTools } from '../headerTools';

beforeEach(() => {
  resetHeaderToolRegistry();
});

afterEach(() => {
  vi.doUnmock('@b2b-system/web-shared/constants');
  vi.resetModules();
});

describe('registerBuiltinHeaderTools（頂列的內建工具）', () => {
  it('依 order 登記佇列、連線狀態、語言、主題，名稱都有語系鍵', () => {
    registerBuiltinHeaderTools();
    const tools = getHeaderTools();
    expect(tools.map((tool) => tool.key)).toEqual([
      'batchQueue',
      'realtimeStatus',
      'language',
      'theme',
    ]);
    for (const tool of tools) expect(tool.labelI18nKey).toBeTruthy();
  });

  it('重複登記 → 丟例外（不靜默覆寫）', () => {
    registerBuiltinHeaderTools();
    expect(() => registerBuiltinHeaderTools()).toThrow();
  });

  it('只支援一種語言時不登記語言選單', async () => {
    vi.resetModules();
    vi.doMock('@b2b-system/web-shared/constants', async (importOriginal) => ({
      ...(await importOriginal<typeof Constants>()),
      SUPPORTED_LANGUAGES: ['zh-TW'],
    }));
    const toolbar = await import('@b2b-system/web-core/toolbar');
    const { registerBuiltinHeaderTools: register } = await import('../headerTools');
    toolbar.resetHeaderToolRegistry();

    register();

    expect(toolbar.getHeaderTools().map((tool) => tool.key)).toEqual([
      'batchQueue',
      'realtimeStatus',
      'theme',
    ]);
  });
});
