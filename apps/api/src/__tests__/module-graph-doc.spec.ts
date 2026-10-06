import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const MODULES_DIR = resolve(__dirname, '../modules');
const ARCHITECTURE_DOC = resolve(
  __dirname,
  '../../../../docs/architecture/backend/01-architecture.md',
);

interface ModuleInfo {
  /** 類別名稱去掉 `Module`（例：`OidcProvider`）。 */
  name: string;
  imports: string[];
  global: boolean;
}

/** 每個 `modules/<name>/<name>.module.ts` 的類別名稱、`imports` 裡的業務模組與是否 `@Global()`。 */
function readModules(): ModuleInfo[] {
  const parsed = readdirSync(MODULES_DIR).flatMap((folder) =>
    readdirSync(resolve(MODULES_DIR, folder))
      .filter((file) => file.endsWith('.module.ts'))
      .map((file) => {
        const source = readFileSync(resolve(MODULES_DIR, folder, file), 'utf8');
        const declaration = /@Module\(\{([\s\S]*?)\}\)\s*export class (\w+)Module\b/.exec(source);
        if (!declaration) throw new Error(`${folder}/${file} 找不到 @Module`);
        const imports = /imports:\s*\[([\s\S]*?)\]/.exec(declaration[1] ?? '')?.[1] ?? '';
        return {
          name: declaration[2] ?? '',
          rawImports: [...imports.matchAll(/\b(\w+)Module\b/g)].map((match) => match[1] ?? ''),
          global: /@Global\(\)/.test(source),
        };
      }),
  );
  const names = new Set(parsed.map((module) => module.name));
  // 只看 modules/ 底下的業務模組（JwtModule 這類第三方模組不在圖上）
  return parsed.map(({ rawImports, ...module }) => ({
    ...module,
    imports: rawImports.filter((name) => names.has(name)),
  }));
}

/** §4 的圖：`XxxModule ──▶ A · B`、`沒有 imports：…`、`@Global：…` 三種列。 */
function readDocumentedGraph() {
  const markdown = readFileSync(ARCHITECTURE_DOC, 'utf8');
  const start = markdown.indexOf('\n## 4. 模組相依');
  const block = /```\n([\s\S]*?)```/.exec(markdown.slice(start))?.[1] ?? '';
  const list = (text: string) =>
    text
      .replace(/（.*?）/g, '')
      .split('·')
      .map((name) => name.trim())
      .filter(Boolean);
  const edges = new Map<string, string[]>();
  let isolated: string[] = [];
  let global: string[] = [];
  for (const line of block.split('\n')) {
    const edge = /[├└]─ (\w+)Module\s+──▶ (.+)$/.exec(line);
    if (edge) edges.set(edge[1] ?? '', list(edge[2] ?? ''));
    const none = /[├└]─ 沒有 imports：(.+)$/.exec(line);
    if (none) isolated = list(none[1] ?? '');
    const globals = /[├└]─ @Global：(.+)$/.exec(line);
    if (globals) global = list(globals[1] ?? '');
  }
  return { edges, isolated, global };
}

describe('模組相依圖與 *.module.ts 一致（docs/architecture/backend/01-architecture.md §4）', () => {
  const modules = readModules();
  const documented = readDocumentedGraph();

  it('每條 imports 的邊都畫在圖上，圖上沒有不存在的邊', () => {
    const actual = Object.fromEntries(
      modules
        .filter((module) => module.imports.length > 0)
        .map((module) => [module.name, module.imports.toSorted()]),
    );
    const drawn = Object.fromEntries(
      [...documented.edges].map(([name, imports]) => [name, imports.toSorted()]),
    );
    expect(drawn).toEqual(actual);
  });

  it('「沒有 imports」列出的正好是沒有 imports 的模組', () => {
    const actual = modules.filter((module) => module.imports.length === 0).map((m) => m.name);
    expect(documented.isolated.toSorted()).toEqual(actual.toSorted());
  });

  it('「@Global」列出的正好是 @Global() 的模組', () => {
    const actual = modules.filter((module) => module.global).map((module) => module.name);
    expect(documented.global.toSorted()).toEqual(actual.toSorted());
  });
});
