import { ALL_ERROR_CODES } from '@b2b-system/error-codes';
import { describe, expect, it } from 'vitest';

import { ERROR_MESSAGE_KEY } from '../../errors';
import enUS from '../resources/en_US.json';
import zhTW from '../resources/zh_TW.json';

/**
 * 錯誤碼清單直接讀與 api 共用的 `@b2b-system/error-codes`，不手抄：後端新增錯誤碼而這裡忘了翻譯時就會失敗。
 * 缺翻譯會靜默降級成通用訊息，所以用測試擋下（docs/architecture/frontend/08-i18n.md §3.1）。
 */
const bundles = { zh_TW: zhTW, en_US: enUS } as Record<string, Record<string, unknown>>;

function lookup(bundle: Record<string, unknown>, path: string[]): unknown {
  return path.reduce<unknown>(
    (node, key) =>
      typeof node === 'object' && node !== null
        ? (node as Record<string, unknown>)[key]
        : undefined,
    bundle,
  );
}

describe('web-core 的語系包', () => {
  for (const [name, bundle] of Object.entries(bundles)) {
    it(`${name}：每個 ErrorCode 都有翻譯`, () => {
      const missing = ALL_ERROR_CODES.filter((code) => !lookup(bundle, ['error', code]));
      expect(missing, `缺少：${missing.join(', ')}`).toEqual([]);
    });

    it(`${name}：ERROR_MESSAGE_KEY 的每個語系鍵都有翻譯`, () => {
      const missing = Object.values(ERROR_MESSAGE_KEY).filter(
        (key) => !lookup(bundle, key.split('.')),
      );
      expect(missing, `缺少：${missing.join(', ')}`).toEqual([]);
    });
  }

  it('兩個語系的鍵集合一致', () => {
    const flatten = (value: unknown, prefix = ''): string[] =>
      typeof value === 'object' && value !== null
        ? Object.entries(value).flatMap(([key, child]) =>
            flatten(child, prefix ? `${prefix}.${key}` : key),
          )
        : [prefix];

    expect(new Set(flatten(zhTW))).toEqual(new Set(flatten(enUS)));
  });
});
