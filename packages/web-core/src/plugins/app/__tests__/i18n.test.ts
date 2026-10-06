import { getDateTimeDefaults, setDateTimeDefaults } from '@b2b-system/web-shared/date';
import { waitFor } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import type { AppPluginFactory } from '../../../app';
import { i18n } from '../../../locales';
import { applyAccountPreferences, useLocaleStore, useTimezoneStore } from '../../../store';
import { i18nPlugin } from '../i18n';

async function install() {
  // plugin 不讀 context，給一個空物件即可
  const plugin = i18nPlugin({ locales: {} })({} as unknown as Parameters<AppPluginFactory>[0]);
  await plugin.onInit?.();
  return plugin;
}

describe('i18nPlugin', () => {
  beforeAll(async () => {
    useLocaleStore.setState({ locale: 'zh-TW' });
    useTimezoneStore.setState({ timezone: 'Asia/Taipei' });
    await install();
  });

  afterEach(async () => {
    useLocaleStore.setState({ locale: 'zh-TW' });
    useTimezoneStore.setState({ timezone: 'Asia/Taipei' });
    await waitFor(() => expect(i18n.language).toBe('zh-TW'));
    setDateTimeDefaults({ locale: 'zh-TW', timeZone: 'Asia/Taipei' });
    localStorage.clear();
  });

  it('帳號的偏好（profile 水合）→ 介面切成帳號的語系、日期用帳號的時區', async () => {
    applyAccountPreferences({ locale: 'en-US', timezone: 'Europe/Berlin' });
    await waitFor(() => expect(i18n.language).toBe('en-US'));
    expect(getDateTimeDefaults()).toMatchObject({ locale: 'en-US', timeZone: 'Europe/Berlin' });
  });

  it('<html lang> 跟著介面語系：初始化時設定，切換成 en-US 之後是 en', async () => {
    expect(document.documentElement.lang).toBe('zh-Hant');
    useLocaleStore.getState().setLocale('en-US');
    await waitFor(() => expect(document.documentElement.lang).toBe('en'));
  });
});
