import { describe, expect, it } from 'vitest';

import enUS from '../locales/en_US.json';
import zhTW from '../locales/zh_TW.json';

/**
 * 後端的 `PERMISSION_SEED` 是這兩份翻譯的來源。
 * 缺翻譯會靜默降級成通用訊息，所以用測試擋下（docs/architecture/frontend/08-i18n.md §3.1）。
 *
 * 錯誤訊息（`error.*`）與其他共用字串在 `@b2b-system/web-core` 的語系包，由那邊的測試檢查。
 */

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
  ['authz', 'explain'],
  ['serviceAccount', 'create'],
  ['serviceAccount', 'read'],
  ['serviceAccount', 'update'],
  ['serviceAccount', 'delete'],
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
