import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, normalize, relative } from 'node:path';

import { describe, expect, it } from 'vitest';

import { FRONTEND_PACKAGES, frontendApps, packageRoot, sourceFiles } from './workspace';
import type { FrontendPackage, SourceRoot } from './workspace';

/**
 * 前端的層級依賴（docs/coding-standards/07-layer-dependencies.md §1、§2）。後端的版本是
 * apps/api/src/__tests__/layer-dependencies.spec.ts；這裡掃兩個 app（依賴 web-core 的都算）與三個前端 package。
 */

/** 測試檔、app 的 `src/test/` 不受矩陣限制（§2.2 最後一段），但正式程式碼不可 import 它們。 */
const TEST_PATH = /(^|\/)__tests__\/|\.(test|spec)\.tsx?$|^test\//;

interface ImportEdge {
  /** 相對於 `src/` 的檔案路徑。 */
  from: string;
  specifier: string;
  /** `@/` 與相對路徑解析成相對於 `src/` 的路徑（副檔名照原樣，通常沒有）；套件是 `undefined`。 */
  local: string | undefined;
  /** `import()`（`main.tsx` 載入 mocks 的條件，§2.2 註 4）。 */
  dynamic: boolean;
}

/** 靜態的 import／export … from（含 `import type`：型別也是依賴）與只為副作用的 import。 */
const STATIC_IMPORT = /^\s*(?:import|export)\b[^'";]*?\bfrom\s*['"]([^'"]+)['"]/gm;
const SIDE_EFFECT_IMPORT = /^\s*import\s*['"]([^'"]+)['"]/gm;
const DYNAMIC_IMPORT = /\bimport\(\s*['"]([^'"]+)['"]\s*\)/g;

/** `import()` 出現在註解裡（例如說明 lazy 載入的 JSDoc）時不算。 */
function inComment(source: string, index: number): boolean {
  const lineStart = source.lastIndexOf('\n', index) + 1;
  const before = source.slice(lineStart, index);
  return /^\s*(\*|\/\*)/.test(before) || before.includes('//');
}

function specifiersOf(source: string): { specifier: string; dynamic: boolean }[] {
  return [
    ...[...source.matchAll(STATIC_IMPORT), ...source.matchAll(SIDE_EFFECT_IMPORT)].map(
      ([, specifier = '']) => ({ specifier, dynamic: false }),
    ),
    ...[...source.matchAll(DYNAMIC_IMPORT)]
      .filter((match) => !inComment(source, match.index))
      .map(([, specifier = '']) => ({ specifier, dynamic: true })),
  ];
}

function resolveLocal(from: string, specifier: string): string | undefined {
  if (specifier.startsWith('@/')) return specifier.slice(2);
  if (specifier.startsWith('.')) return normalize(join(dirname(from), specifier));
  return undefined;
}

function importsOf({ srcDir }: SourceRoot): ImportEdge[] {
  return sourceFiles(srcDir, /\.tsx?$/)
    .map((file) => relative(srcDir, file))
    .filter((from) => !TEST_PATH.test(from))
    .flatMap((from) =>
      specifiersOf(readFileSync(join(srcDir, from), 'utf8'))
        // 樣式不是程式的依賴（`main.tsx` 的 `./index.css`、元件的 CSS Module）
        .filter(({ specifier }) => !specifier.endsWith('.css'))
        .map(({ specifier, dynamic }) => ({
          from,
          specifier,
          local: resolveLocal(from, specifier),
          dynamic,
        })),
    );
}

function format(edges: readonly ImportEdge[]): string {
  return edges.map(({ from, specifier }) => `${from} → ${specifier}`).join('\n');
}

// ─── app ──────────────────────────────────────────────────────────────

/** app 的 `src/` 底下的路徑屬於哪一層：第一層資料夾；`main.tsx` 是 `main`。 */
function appLayerOf(path: string): string {
  const [head = '', ...rest] = path.split('/');
  return rest.length > 0 ? head : head.replace(/\.tsx?$/, '');
}

/** workspace package 的 specifier 屬於哪一層；第三方套件是 `undefined`（不在矩陣裡）。 */
function packageLayerOf(specifier: string): string | undefined {
  if (specifier.startsWith('@b2b-system/web-core/testing')) return 'testing';
  return /^@b2b-system\/([^/]+)/.exec(specifier)?.[1];
}

function fromLayer({ from }: ImportEdge): string {
  return appLayerOf(from);
}

function targetLayerOf({ local, specifier }: ImportEdge): string | undefined {
  return local === undefined ? packageLayerOf(specifier) : appLayerOf(local);
}

/**
 * §2.2 的矩陣：每一層可以 import 的層（✅ 與 ⚠️ 的格子；⚠️ 的條件由下面各自的 `it` 檢查）。
 * `shared` 是 app 自己的 `src/shared/`，與 `web-shared` 同欄；它是 api-sdk 與 realtime 的收斂點（§1）。
 */
const ALLOWED: Record<string, readonly string[]> = {
  shared: ['web-shared', 'shared', 'api-sdk', 'realtime'],
  core: ['web-shared', 'shared', 'ui', 'web-core', 'core'],
  apis: ['web-shared', 'shared', 'web-core', 'core', 'apis'],
  plugins: ['web-shared', 'shared', 'ui', 'web-core', 'core', 'plugins', 'features', 'app'],
  features: ['web-shared', 'shared', 'ui', 'web-core', 'core', 'apis', 'features'],
  app: ['web-shared', 'shared', 'ui', 'web-core', 'core', 'apis', 'features', 'app'],
  main: [
    'web-shared',
    'shared',
    'ui',
    'web-core',
    'core',
    'apis',
    'plugins',
    'features',
    'app',
    'mocks',
  ],
  mocks: ['web-shared', 'shared', 'mocks'],
};

/** `src/` 底下可以有的資料夾：矩陣裡的層，加上測試輔助 `test/`。 */
const APP_FOLDERS = new Set([...Object.keys(ALLOWED), 'test']);

/** `features/<name>/…` 的 `<name>`；不在 `features/` 底下回傳 `undefined`。 */
function featureOf(path: string): string | undefined {
  const [layer, name] = path.split('/');
  return layer === 'features' ? name : undefined;
}

/** 只能經由 feature 的 `index.tsx`（`@/features/<name>`）匯入（§2.2 註 3）。 */
const FEATURE_INDEX = /^features\/[^/]+(\/index)?$/;

/** `apis/<domain>/<operation>/…` 的 `<domain>/<operation>`；domain 層的檔案（`types.ts`）回傳 `undefined`。 */
function operationOf(path: string): string | undefined {
  const [, domain, operation, ...rest] = path.split('/');
  return rest.length > 0 ? `${domain}/${operation}` : undefined;
}

function domainOf(path: string): string | undefined {
  return path.split('/')[1];
}

/** §2.2 註 1：資源依賴圖可以 import 各操作的 query key；操作與 domain 之間只共用 `types.ts`。 */
function isAllowedApisImport(from: string, to: string): boolean {
  if (to === 'apis/resources') return false; // 操作反過來 import 依賴圖會形成循環
  if (from === 'apis/resources.ts') return to.endsWith('/query') || to.endsWith('/types');
  const target = operationOf(to);
  if (target !== undefined) return target === operationOf(from);
  return domainOf(to) === domainOf(from) || to.endsWith('/types');
}

const camelCase = (kebab: string) =>
  kebab.replace(/-([a-z])/g, (_, letter: string) => letter.toUpperCase());

/** `export { a, b as c }` 的一項匯出成什麼名字。 */
const exportedAs = (item: string) =>
  item
    .trim()
    .split(/\s+as\s+/)
    .pop() ?? '';

/** `index.tsx` 匯出的名字：`export { a, b as c }`、`export * as X`、`export const／function／class X`。 */
function exportedNames(source: string): Set<string> {
  return new Set([
    ...[...source.matchAll(/\bexport\s*(?:type\s*)?\{([^}]*)\}/g)].flatMap(([, list = '']) =>
      list.split(',').map(exportedAs).filter(Boolean),
    ),
    ...[...source.matchAll(/\bexport\s*\*\s*as\s+(\w+)/g)].map(([, name = '']) => name),
    ...[...source.matchAll(/\bexport\s+(?:const|function|class)\s+(\w+)/g)].map(
      ([, name = '']) => name,
    ),
  ]);
}

const apps = frontendApps();

describe('前端的層級依賴（docs/coding-standards/07-layer-dependencies.md §2）', () => {
  it('掃得到依賴 web-core 的 app（測試本身有效）', () => {
    expect(apps.map((app) => app.name)).toContain('apps/backstage');
  });

  describe.each(apps)('$name', (app) => {
    const edges = importsOf(app);

    it('src/ 底下的資料夾都是矩陣裡的層（新的層要先加進 §2.2）', () => {
      const unknown = readdirSync(app.srcDir).filter(
        (entry) => statSync(join(app.srcDir, entry)).isDirectory() && !APP_FOLDERS.has(entry),
      );
      expect(unknown).toEqual([]);
    });

    it('每一層只 import 矩陣允許的層（core/ 不 import features/、apis/、app/ 等）', () => {
      const offenders = edges.filter((edge) => {
        const allowed = ALLOWED[fromLayer(edge)];
        const target = targetLayerOf(edge);
        return allowed !== undefined && target !== undefined && !allowed.includes(target);
      });
      expect(offenders, format(offenders)).toEqual([]);
    });

    it('feature 之間不互相 import，相對路徑也算（§2.2 註 2）', () => {
      const offenders = edges.filter(({ from, local }) => {
        const source = featureOf(from);
        const target = local === undefined ? undefined : featureOf(local);
        return source !== undefined && target !== undefined && source !== target;
      });
      expect(offenders, format(offenders)).toEqual([]);
    });

    it('app/、main.tsx、plugins/ 只 import feature 的 index.tsx（§2.2 註 3、註 6）', () => {
      const offenders = edges.filter(
        (edge) =>
          featureOf(edge.from) === undefined &&
          edge.local !== undefined &&
          featureOf(edge.local) !== undefined &&
          !FEATURE_INDEX.test(edge.local),
      );
      expect(offenders, format(offenders)).toEqual([]);
    });

    it('plugins/ 往上只有兩個例外：plugins/features/ 用 ui 與 feature 的入口、i18n 載入 app 的語系包（§2.2 註 6、註 7）', () => {
      const offenders = edges.filter((edge) => {
        if (fromLayer(edge) !== 'plugins') return false;
        const target = targetLayerOf(edge);
        if (target === 'ui' || target === 'features')
          return !edge.from.startsWith('plugins/features/');
        if (target === 'app') {
          return !(
            edge.from === 'plugins/app/i18n.ts' &&
            /^app\/locales\/[^/]+\.json$/.test(edge.local ?? '')
          );
        }
        return false;
      });
      expect(offenders, format(offenders)).toEqual([]);
    });

    it('apis/ 的操作資料夾彼此不 import，跨 domain 只共用 types.ts；只有 apis/resources.ts 可以 import 各操作的 query（§2.2 註 1）', () => {
      const offenders = edges.filter(
        ({ from, local }) =>
          from.startsWith('apis/') &&
          local?.startsWith('apis/') === true &&
          !isAllowedApisImport(from, local),
      );
      expect(offenders, format(offenders)).toEqual([]);
    });

    it('mocks/ 只由 main.tsx 以動態 import() 載入（§2.2 註 4）', () => {
      const offenders = edges.filter(
        (edge) =>
          targetLayerOf(edge) === 'mocks' &&
          fromLayer(edge) !== 'mocks' &&
          !(fromLayer(edge) === 'main' && edge.dynamic),
      );
      expect(offenders, format(offenders)).toEqual([]);
    });

    it('api-sdk 只經由 shared/api-sdk（且只用主入口）、realtime 只經由 shared/websocket-sdk（§1）', () => {
      const offenders = edges.filter((edge) => {
        const target = targetLayerOf(edge);
        if (target === 'api-sdk') {
          return (
            !edge.from.startsWith('shared/api-sdk/') || edge.specifier !== '@b2b-system/api-sdk'
          );
        }
        if (target === 'realtime') return !edge.from.startsWith('shared/websocket-sdk/');
        return false;
      });
      expect(offenders, format(offenders)).toEqual([]);
    });

    it('正式程式碼不 import 測試檔、src/test/ 與 @b2b-system/web-core/testing（§2.2）', () => {
      const offenders = edges.filter(
        (edge) =>
          targetLayerOf(edge) === 'testing' ||
          (edge.local !== undefined && TEST_PATH.test(`${edge.local}.ts`)),
      );
      expect(offenders, format(offenders)).toEqual([]);
    });

    it('每個 features/<name>/index.tsx 都匯出 Routes 與 <name>FeaturePlugin（architecture/frontend/03-feature-anatomy.md §2.1）', () => {
      const featuresDir = join(app.srcDir, 'features');
      const missing = readdirSync(featuresDir)
        .filter((name) => statSync(join(featuresDir, name)).isDirectory())
        .flatMap((name) => {
          const index = join(featuresDir, name, 'index.tsx');
          if (!existsSync(index)) return [`features/${name}/index.tsx 不存在`];
          const names = exportedNames(readFileSync(index, 'utf8'));
          return ['Routes', `${camelCase(name)}FeaturePlugin`]
            .filter((expected) => !names.has(expected))
            .map((expected) => `features/${name}/index.tsx 沒有匯出 ${expected}`);
        });
      expect(missing).toEqual([]);
    });
  });
});

// ─── packages ─────────────────────────────────────────────────────────

/** 每個前端 package 可以依賴的 workspace package（§1；與各自的 package.json 一致）。 */
const PACKAGE_DEPENDENCIES: Record<FrontendPackage, readonly string[]> = {
  'web-shared': ['realtime'],
  ui: ['web-shared', 'rich-text'],
  'web-core': ['ui', 'web-shared', 'error-codes', 'realtime'],
};

describe('前端 package 的層級依賴（docs/coding-standards/07-layer-dependencies.md §1）', () => {
  describe.each(FRONTEND_PACKAGES)('packages/%s', (name) => {
    const edges = importsOf(packageRoot(name));

    it('不 import app：沒有 `@/`，相對路徑不跳出 src/（core/ 與 web-core 不認識 features/）', () => {
      const offenders = edges.filter(
        ({ specifier, local }) => specifier.startsWith('@/') || local?.startsWith('..') === true,
      );
      expect(offenders, format(offenders)).toEqual([]);
    });

    it('下層不 import 上層（web-shared ← ui ← web-core）；package 內部用相對路徑', () => {
      const allowed = PACKAGE_DEPENDENCIES[name];
      const offenders = edges.filter(({ specifier }) => {
        const target = packageLayerOf(specifier);
        return target !== undefined && !allowed.includes(target);
      });
      expect(offenders, format(offenders)).toEqual([]);
    });
  });
});
