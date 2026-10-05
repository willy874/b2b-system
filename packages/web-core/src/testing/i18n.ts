import { configureZodErrorMap, i18n, initI18n, mergeLocaleResources } from '../locales';
import zhTW from '../locales/resources/zh_TW.json';

/**
 * 以繁中語系初始化 i18n（這個 package 的共用字串＋傳入的語系包，後面的優先），
 * 讓畫面上的文字與錯誤訊息是真的翻譯，而不是空字串或 key。在 `beforeAll` 呼叫。
 */
export async function initTestI18n(...bundles: Array<Record<string, unknown>>): Promise<void> {
  await initI18n('zh-TW');
  i18n.addResourceBundle(
    'zh-TW',
    'translation',
    mergeLocaleResources(zhTW, ...bundles),
    true,
    true,
  );
  configureZodErrorMap((key, options) => i18n.t(key, options ?? {}));
}
