import { initTestI18n as initCoreTestI18n } from '@b2b-system/web-core/testing';

import zhTW from '@/app/locales/zh_TW.json';

/**
 * 以繁中語系初始化 i18n（web-core 的共用字串＋這個 app 的全域語系包＋傳入的 feature 語系包），
 * 讓畫面上的文字與錯誤訊息是真的翻譯，而不是空字串或 key。在 `beforeAll` 呼叫。
 */
export async function initTestI18n(...bundles: Array<Record<string, unknown>>): Promise<void> {
  await initCoreTestI18n(zhTW, ...bundles);
}
