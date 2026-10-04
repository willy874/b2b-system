import zhTW from '@/app/locales/zh_TW.json';
import { i18n, initI18n, configureZodErrorMap } from '@/core/locales';

/**
 * 以繁中語系初始化 i18n（全域語系包＋傳入的 feature 語系包），讓畫面上的文字與錯誤訊息是真的翻譯，
 * 而不是空字串或 key。在 `beforeAll` 呼叫。
 */
export async function initTestI18n(...bundles: Array<Record<string, unknown>>): Promise<void> {
  await initI18n('zh-TW');
  for (const bundle of [zhTW, ...bundles]) {
    i18n.addResourceBundle('zh-TW', 'translation', bundle, true, true);
  }
  configureZodErrorMap((key, options) => i18n.t(key, options ?? {}) as string);
}
