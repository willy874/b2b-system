import { describe, expect, it } from 'vitest';

import { ERROR_MESSAGE_KEY } from '@/core/errors';

import enUS from '../locales/en_US.json';
import zhTW from '../locales/zh_TW.json';

/**
 * 後端的 `ErrorCode` 與 `PERMISSION_SEED` 是這兩份翻譯的來源。
 * 缺翻譯會靜默降級成通用訊息，所以用測試擋下（docs/architecture/frontend/08-i18n.md §3.1）。
 *
 * 錯誤碼清單直接讀後端的 `ALL_ERROR_CODES`，不手抄：後端新增錯誤碼而前端忘了翻譯時這裡就會失敗
 * 以動態 import 載入，是因為前端的 tsc 專案不收 api 的原始碼；
 * 該檔沒有任何 import，vitest 可以直接轉譯。
 */
const API_ERROR_CODE_MODULE = '../../../../api/src/core/errors/error-code.ts';
const { ALL_ERROR_CODES: ERROR_CODES } = (await import(
  /* @vite-ignore */ API_ERROR_CODE_MODULE
)) as {
  ALL_ERROR_CODES: string[];
};

const PERMISSION_KEYS = [
  ['user', 'create'],
  ['user', 'read'],
  ['user', 'update'],
  ['user', 'delete'],
  ['user', 'assignRole'],
  ['user', 'resetPassword'],
  ['role', 'create'],
  ['role', 'read'],
  ['role', 'update'],
  ['role', 'delete'],
  ['role', 'grantPermission'],
  ['permission', 'read'],
  ['auditLog', 'read'],
  ['system', 'read'],
  ['system', 'update'],
  ['approval', 'read'],
  ['approval', 'review'],
  ['file', 'create'],
  ['file', 'read'],
  ['file', 'update'],
  ['file', 'delete'],
  ['identityProvider', 'create'],
  ['identityProvider', 'read'],
  ['identityProvider', 'update'],
  ['identityProvider', 'delete'],
  ['group', 'create'],
  ['group', 'read'],
  ['group', 'update'],
  ['group', 'delete'],
  ['group', 'assignRole'],
  // 平台的權限目錄（docs/rbac/02-permission-catalog.md §8）：apps/auth 的頁面實際用到的是這幾個
  ['tenant', 'read'],
  ['tenant', 'create'],
  ['tenant', 'update'],
  ['tenant', 'delete'],
  ['platformAdmin', 'read'],
  ['platformAdmin', 'create'],
  ['platformAdmin', 'update'],
  ['platformAuditLog', 'read'],
  ['platformJob', 'read'],
  ['platformJob', 'retry'],
  ['featureFlag', 'read'],
  ['featureFlag', 'update'],
] as const;

const bundles = { zh_TW: zhTW, en_US: enUS } as Record<string, Record<string, unknown>>;

function lookup(bundle: Record<string, unknown>, path: string[]): unknown {
  return path.reduce<unknown>(
    (value, key) => (value as Record<string, unknown> | undefined)?.[key],
    bundle,
  );
}

describe('語系檔完整性', () => {
  for (const [name, bundle] of Object.entries(bundles)) {
    it(`${name}：每個 ErrorCode 都有翻譯`, () => {
      const missing = ERROR_CODES.filter((code) => !lookup(bundle, ['error', code]));
      expect(missing, `缺少：${missing.join(', ')}`).toEqual([]);
    });

    it(`${name}：ERROR_MESSAGE_KEY 的每個語系鍵都有翻譯`, () => {
      const missing = Object.values(ERROR_MESSAGE_KEY).filter(
        (key) => !lookup(bundle, key.split('.')),
      );
      expect(missing, `缺少：${missing.join(', ')}`).toEqual([]);
    });

    it(`${name}：每個權限都有顯示名稱`, () => {
      const missing = PERMISSION_KEYS.filter(
        ([resource, action]) => !lookup(bundle, ['permission', resource, action]),
      ).map(([resource, action]) => `${resource}:${action}`);
      expect(missing, `缺少：${missing.join(', ')}`).toEqual([]);
    });

    it(`${name}：每個資源都有分組名稱`, () => {
      const resources = [...new Set(PERMISSION_KEYS.map(([resource]) => resource))];
      const missing = resources.filter(
        (resource) => !lookup(bundle, ['permission', 'resource', resource]),
      );
      expect(missing, `缺少：${missing.join(', ')}`).toEqual([]);
    });
  }

  it('ERROR_MESSAGE_KEY 涵蓋每個 ErrorCode，且不多不少', () => {
    expect(new Set(Object.keys(ERROR_MESSAGE_KEY))).toEqual(new Set(ERROR_CODES));
  });

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
