import type { AppDynamicPluginFactory } from '@b2b-system/web-core/app';
import { LanguageNamespace, Languages } from '@b2b-system/web-shared/constants';

import { IDENTITY_PROVIDER_LOCALE_SCOPE } from './locale';
import { registerIdentityProviderPagePermissions } from './permission';

/** 可啟用的 feature：由 `app/features.ts` 依租戶的啟用清單安裝（docs/architecture/05-tenancy.md §12）。 */
export function appContextPlugin(): AppDynamicPluginFactory {
  return (context) => {
    // ── 同步階段：權限註冊必須在第一次 render 之前完成 ──
    registerIdentityProviderPagePermissions();
    const app = context.getInstance();

    return {
      name: 'identity-provider-feature-plugin',
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
          { scope: IDENTITY_PROVIDER_LOCALE_SCOPE },
        );
      },
    };
  };
}
