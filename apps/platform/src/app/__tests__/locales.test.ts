import coreEnUS from '@b2b-system/web-core/locales/resources/en_US.json';
import { hasLocaleKey, localeKeySet, pluralProblems } from '@b2b-system/web-core/testing';
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
  ['user', 'resetMfa'],
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
  // 平台的權限目錄（docs/architecture/iam/02-permission-catalog.md §8）：apps/platform 的頁面實際用到的是這幾個
  ['tenant', 'read'],
  ['tenant', 'create'],
  ['tenant', 'update'],
  ['tenant', 'delete'],
  ['platformAdmin', 'read'],
  ['platformAdmin', 'create'],
  ['platformAdmin', 'update'],
  ['platformAdmin', 'resetMfa'],
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

  it('兩個語系的鍵集合一致（複數形的後綴視為同一個鍵）', () => {
    expect(localeKeySet(zhTW)).toEqual(localeKeySet(enUS));
  });
});

/**
 * feature（含 plugins/features）各自的語系包：鍵集合一致、帶數量的句子都有複數形
 * （docs/architecture/frontend/08-i18n.md §4.1、§5）。以 glob 收進來，新增的 feature 不必登記。
 */
const featureBundles = import.meta.glob<{ default: Record<string, unknown> }>(
  ['../../features/*/locales/*.json', '../../plugins/features/*/locales/*.json'],
  { eager: true },
);

const featureLocales = Object.keys(featureBundles)
  .filter((path) => path.endsWith('/en_US.json'))
  .map((path) => ({
    name: path.replace('../../', '').replace('/locales/en_US.json', ''),
    en: featureBundles[path]?.default,
    zh: featureBundles[path.replace('/en_US.json', '/zh_TW.json')]?.default,
  }));

describe('feature 的語系包', () => {
  it('找得到 feature 的語系包（glob 的路徑沒寫錯）', () => {
    expect(featureLocales.length).toBeGreaterThan(5);
  });

  it.each(featureLocales)('$name：兩個語系的鍵集合一致', ({ en, zh }) => {
    expect(localeKeySet(zh)).toEqual(localeKeySet(en));
  });

  it.each([{ name: 'app/locales', en: enUS, zh: zhTW }, ...featureLocales])(
    '$name：帶數量（{{count}}）的句子都有複數形（英文 _one／_other、中文 _other）',
    ({ en, zh }) => {
      expect(pluralProblems(en, zh)).toEqual([]);
    },
  );
});

/** 路由的頁面標題（`staticData.titleKey`，docs/architecture/frontend/08-i18n.md §5）都要有翻譯。 */
const routeSources = import.meta.glob<string>('../../features/*/routes/*.ts', {
  eager: true,
  query: '?raw',
  import: 'default',
});

describe('路由的頁面標題', () => {
  const titleKeys = Object.entries(routeSources).flatMap(([path, source]) =>
    [...source.matchAll(/titleKey: '([^']+)'/g)].map((match) => ({
      path,
      key: match[1] as string,
    })),
  );
  const englishBundles = [coreEnUS, enUS, ...featureLocales.map((locale) => locale.en)];

  it('找得到帶標題的路由', () => {
    expect(titleKeys.length).toBeGreaterThan(5);
  });

  it('每個 titleKey 都有英文翻譯（中文由鍵集合的測試保證）', () => {
    const missing = titleKeys.filter(
      ({ key }) => !englishBundles.some((bundle) => hasLocaleKey(bundle, key)),
    );
    expect(missing).toEqual([]);
  });
});
