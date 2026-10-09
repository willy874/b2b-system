import type { AppPluginFactory } from '@b2b-system/web-core/app';
import { LanguageNamespace, Languages } from '@b2b-system/web-shared/constants';

import { CDN_LOCALE_SCOPE } from './locale';
import { registerCdnNavigation } from './navigation';
import { registerCdnPagePermissions } from './permission';

export function appContextPlugin(): AppPluginFactory {
  return (context) => {
    // ── 同步階段：權限註冊必須在第一次 render 之前完成 ──
    registerCdnPagePermissions();
    registerCdnNavigation();
    const app = context.getInstance();

    return {
      name: 'cdn-feature-plugin',
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
          { scope: CDN_LOCALE_SCOPE },
        );
      },
    };
  };
}
