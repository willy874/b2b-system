import type { AppDynamicPluginFactory } from '@b2b-system/web-core/app';
import { LanguageNamespace, Languages } from '@b2b-system/web-shared/constants';

import { ANNOUNCEMENT_LOCALE_SCOPE } from './locale';
import { registerAnnouncementNavigation } from './navigation';
import { registerAnnouncementPagePermissions } from './permission';
import { registerAnnouncementRouteLinks } from './routeLinks';
import { registerAnnouncementTrashType } from './trash';

/** 可啟用的 feature：由 `app/features.ts` 依租戶的啟用清單安裝（docs/architecture/backend/19-announcement.md §9.2 D20）。 */
export function appContextPlugin(): AppDynamicPluginFactory {
  return (context) => {
    // ── 同步階段：權限、通知連結、回收桶分頁的註冊必須在第一次 render 之前完成 ──
    registerAnnouncementPagePermissions();
    registerAnnouncementNavigation(); // 側欄與命令面板的入口
    registerAnnouncementRouteLinks(); // 站內通知 announcement.published 的連結
    registerAnnouncementTrashType(); // 回收桶的「公告」分頁
    const app = context.getInstance();

    return {
      name: 'announcement-feature-plugin',
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
          { scope: ANNOUNCEMENT_LOCALE_SCOPE },
        );
      },
    };
  };
}
