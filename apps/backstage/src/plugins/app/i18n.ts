import { i18nPlugin as coreI18nPlugin } from '@b2b-system/web-core/plugins/app';
import { Languages } from '@b2b-system/web-shared/constants';

/** 全域語系包：`@b2b-system/web-core` 的共用字串＋這個 app 的 `app/locales/*.json`（app 的鍵優先）。 */
export function i18nPlugin() {
  return coreI18nPlugin({
    locales: {
      [Languages.EN_US]: () => import('@/app/locales/en_US.json'),
      [Languages.ZH_TW]: () => import('@/app/locales/zh_TW.json'),
    },
  });
}
