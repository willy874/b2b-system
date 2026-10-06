import { ALL_ERROR_CODES } from '@b2b-system/error-codes';
import { describe, expect, it } from 'vitest';

import { ERROR_MESSAGE_KEY } from '../../errors';
import { hasLocaleKey, localeKeySet, pluralProblems } from '../../testing/locales';
import enUS from '../resources/en_US.json';
import zhTW from '../resources/zh_TW.json';

/**
 * 錯誤碼清單直接讀與 api 共用的 `@b2b-system/error-codes`，不手抄：後端新增錯誤碼而這裡忘了翻譯時就會失敗。
 * 缺翻譯會靜默降級成通用訊息，所以用測試擋下（docs/architecture/frontend/08-i18n.md §3.1）。
 */
const bundles = { zh_TW: zhTW, en_US: enUS } as Record<string, Record<string, unknown>>;

describe('web-core 的語系包', () => {
  for (const [name, bundle] of Object.entries(bundles)) {
    it(`${name}：每個 ErrorCode 都有翻譯`, () => {
      // 帶數量的訊息是複數形（`error.ROLE_IN_USE_one`／`_other`）
      const missing = ALL_ERROR_CODES.filter((code) => !hasLocaleKey(bundle, `error.${code}`));
      expect(missing, `缺少：${missing.join(', ')}`).toEqual([]);
    });

    it(`${name}：ERROR_MESSAGE_KEY 的每個語系鍵都有翻譯`, () => {
      const missing = Object.values(ERROR_MESSAGE_KEY).filter((key) => !hasLocaleKey(bundle, key));
      expect(missing, `缺少：${missing.join(', ')}`).toEqual([]);
    });
  }

  it('兩個語系的鍵集合一致（複數形的後綴視為同一個鍵）', () => {
    expect(localeKeySet(zhTW)).toEqual(localeKeySet(enUS));
  });

  it('帶數量（{{count}}）的句子都有複數形：英文 _one／_other、中文 _other（docs/architecture/frontend/08-i18n.md §5）', () => {
    expect(pluralProblems(enUS, zhTW)).toEqual([]);
  });
});
