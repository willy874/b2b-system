import { resetRouteLinkRegistry, routeLinkRegistry } from '@b2b-system/web-core/route-link';
import { beforeEach, describe, expect, it } from 'vitest';

/**
 * `<RouteLink to>` 與 `useRouteLinkAccess()` 用到的 route id 都要有 feature 登記
 * （docs/architecture/frontend/03-feature-anatomy.md §4.1）。執行期找不到 id 只會變成文字（對方可能沒安裝），
 * 打錯字、忘了登記、改名沒同步都靠這支測試抓。
 */

/** 每個 feature 的 `routeLinks.ts`，含可啟用的 feature：它們登記的 id 都是「可能存在」的。 */
const routeLinkModules = import.meta.glob<Record<string, unknown>>(
  '../../features/*/routeLinks.ts',
  { eager: true },
);

const sources = import.meta.glob<string>(
  ['../../**/*.tsx', '../../**/*.ts', '!../../**/__tests__/**'],
  { eager: true, query: '?raw', import: 'default' },
);

/**
 * `<RouteLink … to=` 或 `useRouteLinkAccess(` 之後的第一個字元：必須是引號（完整字面量）。
 * 第三條收集以字面量寫成、格式像 route id 的連結物件（命令面板搜尋結果的 `{ route: 'user.detail', params }`），
 * 只檢查 id 有沒有登記；`registerRouteLink` 的 `{ route: UserDetailRoute }`、稽核的 `{ route: 'GET /users' }` 不會被收進來。
 */
const USAGE_PATTERNS = [
  /<RouteLink\b[\s\S]*?\sto=(.)([^"'\s]*)/g,
  /useRouteLinkAccess\(\s*(.)([^"'\s,]*)/g,
  /\{\s*route:\s*(['"])([a-z][A-Za-z0-9]*(?:\.[a-z][A-Za-z0-9]*)+)\1/g,
];

interface Usage {
  file: string;
  quote: string;
  id: string;
}

function collectUsages(): Usage[] {
  return Object.entries(sources).flatMap(([file, source]) =>
    USAGE_PATTERNS.flatMap((pattern) =>
      [...source.matchAll(pattern)].map(([, quote = '', id = '']) => ({ file, quote, id })),
    ),
  );
}

describe('route id 完整性', () => {
  beforeEach(() => resetRouteLinkRegistry());

  it('原始碼裡的 route id 都是完整字面量，而且都有 feature 登記', () => {
    for (const module of Object.values(routeLinkModules)) {
      for (const [name, value] of Object.entries(module)) {
        if (name.startsWith('register') && typeof value === 'function') value();
      }
    }
    const registered = new Set(routeLinkRegistry.store.getState().entries.keys());
    const usages = collectUsages();

    expect(usages.length).toBeGreaterThan(0);
    expect(usages.filter((usage) => usage.quote !== '"' && usage.quote !== "'")).toEqual([]);
    expect(usages.filter((usage) => !registered.has(usage.id))).toEqual([]);
  });
});
