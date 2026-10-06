import { Languages } from '@b2b-system/web-shared/constants';
import type { Language } from '@b2b-system/web-shared/constants';

import type { LocaleImporter } from './i18n';

/**
 * 這個 package 自己用到的字串（`common`、`error`、`validation`、`components`、`theme`、`language`、`realtime`、`layout`、`changePassword`、`job` 與 `auditLog` 的共用部分）。
 * app 的全域語系包與它合併（`mergeLocaleImporters`），app 的同名鍵覆寫這裡的。
 */
export const CORE_LOCALES: Record<Language, LocaleImporter> = {
  [Languages.EN_US]: () => import('./resources/en_US.json'),
  [Languages.ZH_TW]: () => import('./resources/zh_TW.json'),
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** 深層合併：後面的覆寫前面的；巢狀物件逐層合併，不整包取代。 */
export function mergeLocaleResources(
  ...resources: Array<Record<string, unknown>>
): Record<string, unknown> {
  const merged: Record<string, unknown> = {};
  for (const resource of resources) {
    for (const [key, value] of Object.entries(resource)) {
      const current = merged[key];
      merged[key] =
        isPlainObject(current) && isPlainObject(value)
          ? mergeLocaleResources(current, value)
          : value;
    }
  }
  return merged;
}

/** 把多個語系包的載入合成一個（並行下載，依序合併）。 */
export function mergeLocaleImporters(...importers: LocaleImporter[]): LocaleImporter {
  return async () => {
    const modules = await Promise.all(importers.map((load) => load()));
    return { default: mergeLocaleResources(...modules.map((module) => module.default)) };
  };
}
