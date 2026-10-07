import type { AppPluginFactory } from '@b2b-system/web-core/app';
import { LanguageNamespace, Languages } from '@b2b-system/web-shared/constants';

import { FEATURE_FLAG_LOCALE_SCOPE } from './locale';
import { registerFeatureFlagNavigation } from './navigation';
import { registerFeatureFlagPagePermissions } from './permission';
import { registerFeatureFlagPreferences } from './preference';

export function appContextPlugin(): AppPluginFactory {
  return (context) => {
    // ── 同步階段：權限註冊必須在第一次 render 之前完成 ──
    registerFeatureFlagPagePermissions();
    registerFeatureFlagNavigation(); // 側欄與命令面板的入口
    registerFeatureFlagPreferences(); // 偏好頁的列表註冊表
    const app = context.getInstance();

    return {
      name: 'feature-flag-feature-plugin',
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
          { scope: FEATURE_FLAG_LOCALE_SCOPE },
        );
      },
    };
  };
}
