import type { AppPluginFactory } from '@b2b-system/web-core/app';
import { LanguageNamespace, Languages } from '@b2b-system/web-shared/constants';

import { SECURITY_LOCALE_SCOPE } from './locale';
import { registerSecurityNavigation } from './navigation';
import { registerSecurityPagePermissions } from './permission';

/**
 * 常駐的 feature（不是可關閉的 feature）：安全政策不應該因為平台關掉「系統設定」頁就看不到
 * （docs/architecture/backend/21-mfa.md §6）。
 */
export function appContextPlugin(): AppPluginFactory {
  return (context) => {
    // ── 同步階段：權限註冊必須在第一次 render 之前完成 ──
    registerSecurityPagePermissions();
    registerSecurityNavigation();
    const app = context.getInstance();

    return {
      name: 'security-feature-plugin',
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
          { scope: SECURITY_LOCALE_SCOPE },
        );
      },
    };
  };
}
