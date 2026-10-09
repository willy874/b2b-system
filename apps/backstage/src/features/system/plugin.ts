import type { AppDynamicPluginFactory, AppPluginFactory } from '@b2b-system/web-core/app';
import { LanguageNamespace, Languages } from '@b2b-system/web-shared/constants';

import { SYSTEM_LOCALE_SCOPE } from './locale';
import { registerSettingTab, registerSystemNavigation } from './navigation';
import { registerSettingPagePermissions, registerSystemPagePermissions } from './permission';

/**
 * 常駐：系統設定的入口與外框（docs/architecture/frontend/02-plugin-system.md §4.5）。
 * 安全性、事件通知、審批流程的分頁由各自的 feature 登記，不能因為平台關掉「一般」分頁就看不到。
 */
export function appContextPlugin(): AppPluginFactory {
  return () => {
    // ── 同步階段：權限註冊必須在第一次 render 之前完成 ──
    registerSystemPagePermissions();
    registerSystemNavigation(); // 側欄與命令面板的入口
    return { name: 'system-feature-plugin' };
  };
}

/** 可啟用的 feature `systemSetting`：「一般」分頁，由 `app/features.ts` 依租戶的啟用清單安裝（docs/architecture/05-tenancy.md §12）。 */
export function settingPlugin(): AppDynamicPluginFactory {
  return (context) => {
    registerSettingPagePermissions();
    registerSettingTab();
    const app = context.getInstance();

    return {
      name: 'system-setting-feature-plugin',
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
          { scope: SYSTEM_LOCALE_SCOPE },
        );
      },
    };
  };
}
