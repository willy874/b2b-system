import { existsSync, readFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * 首屏（entry chunk 與它 modulepreload 的 chunk）就是從 `main.tsx` 沿著 **靜態** import 走得到的模組；
 * `import()`（lazy 頁面、lazy 偏好分頁）另成 chunk。app 沒有宣告 `sideEffects`，打包器會保留 barrel 轉出的每一個模組，
 * 所以這裡只看 app 自己的檔案（不進 packages），就等於 app 在首屏帶了哪些檔案。
 * 背景：docs/architecture/frontend/02-plugin-system.md §4.3、§5。
 */

const SRC = resolve(__dirname, '../..');

/** 執行期的靜態 import／re-export（`import type`、`export type` 編譯後消失；`import()` 不算） */
const STATIC_IMPORT = /^\s*(?:import|export)\s+(?!type\b)(?:[^'";]*?\s+from\s+)?['"]([^'"]+)['"]/gm;

function resolveLocal(from: string, specifier: string): string | undefined {
  let base: string;
  if (specifier.startsWith('@/')) base = resolve(SRC, specifier.slice(2));
  else if (specifier.startsWith('.')) base = resolve(dirname(from), specifier);
  else return undefined; // 套件：不在這支測試的範圍
  const candidates = [base, `${base}.ts`, `${base}.tsx`, `${base}/index.ts`, `${base}/index.tsx`];
  return candidates.find((path) => /\.tsx?$/.test(path) && existsSync(path));
}

interface EntryGraph {
  /** 相對於 src/ 的檔案 */
  files: Set<string>;
  /** 首屏的檔案 import 的套件 specifier → 匯入它的檔案 */
  packages: Map<string, string[]>;
}

function entryGraph(entry: string): EntryGraph {
  const files = new Set<string>();
  const packages = new Map<string, string[]>();
  const visit = (file: string): void => {
    const name = relative(SRC, file);
    if (files.has(name)) return;
    files.add(name);
    for (const [, specifier = ''] of readFileSync(file, 'utf8').matchAll(STATIC_IMPORT)) {
      const target = resolveLocal(file, specifier);
      if (target) visit(target);
      else if (!specifier.startsWith('.') && !specifier.startsWith('@/'))
        packages.set(specifier, [...(packages.get(specifier) ?? []), name]);
    }
  };
  visit(entry);
  return { files, packages };
}

/**
 * 只有特定頁面才用、體積大的模組：出現在首屏代表有東西把頁面的程式拉進了同步的 import。
 * `@b2b-system/ui/Table` 不列：feature 的 `preference.ts` 在首屏取用它的常數（`SELECT_COLUMN_ID`），
 * ui 宣告了 `sideEffects`，沒用到的 `Table` 元件會被打包器丟掉；`Table` 本體由上面的 barrel 檢查涵蓋。
 */
const PAGE_ONLY_PACKAGES = [
  /^@b2b-system\/ui\/Select$/, // 虛擬捲動的下拉列表
  /^@dnd-kit\//, // TableSettings 的拖曳排序
  /^@b2b-system\/api-sdk\/schemas$/, // 所有端點的 zod schema（docs/architecture/backend/03-api-conventions.md §12.6）
];

describe('首屏的靜態 import（docs/architecture/frontend/02-plugin-system.md §4.3）', () => {
  const graph = entryGraph(resolve(SRC, 'main.tsx'));

  it('走得到 app、features 的 plugin 與錯誤頁（測試本身有效）', () => {
    expect(graph.files).toContain('app/plugin.ts');
    expect(graph.files).toContain('core/components/ErrorPage/ErrorPage.tsx');
    expect(graph.files).toContain('features/notification/plugin.ts');
  });

  it('不經過 `@/core/components` 的 barrel（會把 ApiToken、Tag 等頁面元件一起帶進來）', () => {
    expect(graph.files).not.toContain('core/components/index.ts');
  });

  it('偏好頁的分頁以 lazy 登記，本體不在首屏', () => {
    expect(graph.files).not.toContain(
      'plugins/features/table-column-settings/TableColumnsSection.tsx',
    );
    expect(graph.files).not.toContain(
      'features/notification/components/NotificationPreferenceSection.tsx',
    );
  });

  it('不 import 只有頁面才用的大型模組', () => {
    const offenders = [...graph.packages]
      .filter(([specifier]) => PAGE_ONLY_PACKAGES.some((pattern) => pattern.test(specifier)))
      .map(([specifier, importers]) => `${specifier} ← ${importers.join(', ')}`);
    expect(offenders).toEqual([]);
  });
});
