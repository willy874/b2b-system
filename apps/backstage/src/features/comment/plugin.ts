import type { AppPluginFactory } from '@b2b-system/web-core/app';
import { LanguageNamespace, Languages } from '@b2b-system/web-shared/constants';

import { COMMENT_LOCALE_SCOPE } from './locale';
import { registerCommentPanel } from './panel';

export function appContextPlugin(): AppPluginFactory {
  return (context) => {
    // ── 同步階段 ──
    registerCommentPanel(); // 資源頁的「留言」面板
    const app = context.getInstance();

    return {
      name: 'app-comment-feature-plugin',
      // ── 非同步階段：面板掛上時才下載語系包（`<ResourcePanels>`） ──
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
          { scope: COMMENT_LOCALE_SCOPE },
        );
      },
    };
  };
}
