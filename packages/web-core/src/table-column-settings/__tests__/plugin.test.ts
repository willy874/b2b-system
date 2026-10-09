import { afterEach, describe, expect, it, vi } from 'vitest';

import { getPreferenceSections, resetPreferenceRegistry } from '../../preference';
import { localeKeySet } from '../../testing/locales';
import { TABLE_COLUMN_SETTINGS_LOCALE_SCOPE } from '../locale';
import enUS from '../locales/en_US.json';
import zhTW from '../locales/zh_TW.json';
import { tableColumnSettingsPlugin } from '../plugin';

type PluginContext = Parameters<ReturnType<typeof tableColumnSettingsPlugin>>[0];

function install() {
  const addResourceBundle = vi.fn();
  const context = { getInstance: () => ({ addResourceBundle }) } as unknown as PluginContext;
  const plugin = tableColumnSettingsPlugin()(context);
  return { plugin, addResourceBundle };
}

describe('tableColumnSettingsPlugin（docs/architecture/frontend/02-plugin-system.md §4.3）', () => {
  afterEach(() => {
    resetPreferenceRegistry();
  });

  it('同步階段就登記「表格欄位」分頁，並帶上自己的語系 scope', () => {
    install();
    expect(getPreferenceSections()).toEqual([
      expect.objectContaining({
        key: 'table-columns',
        labelI18nKey: 'preference.tableColumns.title',
        localeScope: TABLE_COLUMN_SETTINGS_LOCALE_SCOPE,
      }),
    ]);
  });

  it('分頁以 lazy 元件登記：本體（TableSettings 帶的 dnd-kit）不進首屏', () => {
    install();
    const [section] = getPreferenceSections();
    if (!section) throw new Error('沒有登記分頁');
    expect((section.Component as unknown as { $$typeof: symbol }).$$typeof).toBe(
      Symbol.for('react.lazy'),
    );
  });

  it('onInit 以自己的 scope 登記語系包', async () => {
    const { plugin, addResourceBundle } = install();
    await plugin.onInit?.();
    expect(addResourceBundle).toHaveBeenCalledWith(expect.any(Object), {
      scope: TABLE_COLUMN_SETTINGS_LOCALE_SCOPE,
    });
  });

  it('兩個語系的鍵集合一致', () => {
    expect(localeKeySet(zhTW)).toEqual(localeKeySet(enUS));
  });
});
