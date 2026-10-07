import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, normalize, relative, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const srcDir = resolve(__dirname, '..');

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = resolve(dir, entry);
    if (statSync(full).isDirectory()) return entry === '__tests__' ? [] : walk(full);
    return /\.tsx?$/.test(entry) && !entry.endsWith('.spec.ts') ? [full] : [];
  });
}

interface ImportEdge {
  /** 相對於 `src/` 的檔案路徑。 */
  from: string;
  /** 相對於 `src/` 的目標路徑（不含副檔名）；外部套件不列入。 */
  to: string;
}

const IMPORT_PATTERN = /(?:^|\n)\s*(?:import|export)\b[^'"]*?from\s*['"]([^'"]+)['"]/g;

function resolveSpecifier(file: string, specifier: string): string | null {
  if (specifier.startsWith('@/')) return specifier.slice(2);
  if (specifier.startsWith('.')) return normalize(join(dirname(file), specifier));
  return null;
}

const edges: ImportEdge[] = walk(srcDir).flatMap((full) => {
  const from = relative(srcDir, full);
  const source = readFileSync(full, 'utf8');
  return [...source.matchAll(IMPORT_PATTERN)].flatMap(([, specifier]) => {
    const to = specifier ? resolveSpecifier(from, specifier) : null;
    return to ? [{ from, to }] : [];
  });
});

/** `modules/<name>/…` 的 `<name>`；不在 `modules/` 底下回傳 `null`。 */
function moduleOf(path: string): string | null {
  const [layer, name] = path.split('/');
  return layer === 'modules' && name ? name : null;
}

function format(list: readonly ImportEdge[]): string {
  return list.map(({ from, to }) => `${from} → ${to}`).join('\n');
}

/**
 * 全域葉節點與 credential（docs/architecture/backend/01-architecture.md §4）：只能依賴彼此，
 * 否則 `PermissionsGuard` 或依賴 credential 的模組會把一整串業務模組帶進來。
 * `platform-notification` 被 `platform-admin`（換角色時通知本人）依賴，所以也必須是葉節點。
 */
const LEAF_MODULES = new Set([
  'permission',
  'audit-log',
  'platform-admin',
  'platform-notification',
  'credential',
]);

/** `common/guards/permissions.guard.ts` 可以注入的 service（docs/coding-standards/07-layer-dependencies.md §3.2 註 4）。 */
const GUARD_ALLOWED = new Set([
  'modules/permission/permission.service',
  'modules/audit-log/audit.service',
  'modules/platform-admin/platform-admin.service',
  'modules/platform-admin/platform-audit.service',
]);

/**
 * 執行期（`core/`、`common/`、`modules/`）可以 import 的 `db/` 檔案（docs/coding-standards/07-layer-dependencies.md §3.2 註 1）。
 * 其餘的 `db/`（seed、migrate、reset 等 CLI）讀 `.env`、用 `console`，改它們不該變成 api 程序的行為。
 * 白名單裡的檔案自己 import 的 `db/` 檔案也要在白名單裡。
 */
const RUNTIME_DB_ALLOWED = [
  /^db\/schema(\/|$)/,
  /^db\/platform\/schema(\/|$)/,
  /^db\/relations$/,
  /^db\/seeds\/(permissions|platform-permissions|roles)$/,
  /^db\/(provision|connect)$/,
  /^db\/bootstrap(\/|$)/,
  /^db\/migrations\/meta\/_journal\.json$/,
];

const isRuntimeDbAllowed = (path: string) => RUNTIME_DB_ALLOWED.some((rule) => rule.test(path));

describe('後端的層級依賴（docs/coding-standards/07-layer-dependencies.md §3）', () => {
  it('core/ 不 import modules/ 與 common/', () => {
    const offenders = edges.filter(
      ({ from, to }) => from.startsWith('core/') && /^(modules|common)\//.test(to),
    );
    expect(offenders, format(offenders)).toEqual([]);
  });

  it('執行期只 import 白名單裡的 db/ 檔案（seed、migrate 等 CLI 腳本不進 api 程序）', () => {
    const offenders = edges.filter(({ from, to }) => {
      if (!to.startsWith('db/') || isRuntimeDbAllowed(to)) return false;
      const runtime = /^(core|common|modules)\//.test(from);
      const allowedDbFile =
        from.startsWith('db/') && isRuntimeDbAllowed(from.replace(/\.tsx?$/, ''));
      return runtime || allowedDbFile;
    });
    expect(offenders, format(offenders)).toEqual([]);
  });

  it('common/ 只有 PermissionsGuard 可以 import modules/，而且只限四個全域葉節點的 service', () => {
    const offenders = edges.filter(
      ({ from, to }) =>
        from.startsWith('common/') &&
        to.startsWith('modules/') &&
        !(from === 'common/guards/permissions.guard.ts' && GUARD_ALLOWED.has(to)),
    );
    expect(offenders, format(offenders)).toEqual([]);
  });

  it('跨模組不 import 對方的 repository 與 controller', () => {
    const offenders = edges.filter(({ from, to }) => {
      const source = moduleOf(from);
      const target = moduleOf(to);
      return source && target && source !== target && /\.(repository|controller)$/.test(to);
    });
    expect(offenders, format(offenders)).toEqual([]);
  });

  it('葉節點模組只依賴其他葉節點', () => {
    const offenders = edges.filter(({ from, to }) => {
      const source = moduleOf(from);
      const target = moduleOf(to);
      return (
        source &&
        target &&
        source !== target &&
        LEAF_MODULES.has(source) &&
        !LEAF_MODULES.has(target)
      );
    });
    expect(offenders, format(offenders)).toEqual([]);
  });

  it('模組之間沒有循環（含只 import 純函式、型別的依賴；import/no-cycle 只看檔案層級）', () => {
    const graph = new Map<string, Set<string>>();
    for (const { from, to } of edges) {
      const source = moduleOf(from);
      const target = moduleOf(to);
      if (!source || !target || source === target) continue;
      graph.set(source, (graph.get(source) ?? new Set()).add(target));
    }

    const cycles: string[] = [];
    const done = new Set<string>();
    const visit = (node: string, path: string[]): void => {
      const seen = path.indexOf(node);
      if (seen >= 0) {
        cycles.push([...path.slice(seen), node].join(' → '));
        return;
      }
      if (done.has(node)) return;
      for (const next of graph.get(node) ?? []) visit(next, [...path, node]);
      done.add(node);
    };
    for (const node of graph.keys()) visit(node, []);

    expect(cycles, cycles.join('\n')).toEqual([]);
  });

  it('不用 forwardRef（循環代表職責畫錯了，docs/coding-standards/03-backend.md §1 #8）', () => {
    const offenders = walk(srcDir)
      .filter((full) => /\bforwardRef\(/.test(readFileSync(full, 'utf8')))
      .map((full) => relative(srcDir, full));
    expect(offenders).toEqual([]);
  });
});
