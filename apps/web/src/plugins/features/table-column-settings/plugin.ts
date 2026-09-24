import type { AppPluginFactory } from '@/core/app';
import { registerPreferenceSection } from '@/core/preference';
import { LanguageNamespace, Languages } from '@/shared/constants/lang';

import { TABLE_COLUMN_SETTINGS_LOCALE_SCOPE } from './locale';
import { TableColumnsSection } from './TableColumnsSection';

/**
 * 表格欄位設定的偏好分頁（docs/architecture/frontend/02-plugin-system.md §4.3）。
 * 拿掉 `main.tsx` 裡那一行，偏好頁就沒有這個分頁；列表上的齒輪按鈕不受影響。
 */
export function tableColumnSettingsPlugin(): AppPluginFactory {
  return (context) => {
    // 同步階段：偏好頁第一次渲染前分頁就已存在
    registerPreferenceSection({
      key: 'table-columns',
      order: 200,
      labelI18nKey: 'preference.tableColumns.title',
      Component: TableColumnsSection,
      localeScope: TABLE_COLUMN_SETTINGS_LOCALE_SCOPE,
    });
    const app = context.getInstance();

    return {
      name: 'plugin-table-column-settings',
      onInit: () => {
        app.addResourceBundle(
          {
            [Languages.EN_US]: {
              [LanguageNamespace.TRANSLATE]: () => import('./locales/en_US.json'),
            },
            [Languages.ZH_TW]: {
              [LanguageNamespace.TRANSLATE]: () => import('./locales/zh_TW.json'),
            },
          },
          { scope: TABLE_COLUMN_SETTINGS_LOCALE_SCOPE },
        );
      },
    };
  };
}
