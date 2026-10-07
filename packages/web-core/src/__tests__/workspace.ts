import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

/**
 * 掃描整個前端原始碼的測試共用（`layer-dependencies.test.ts`、`comment-paths.test.ts`）。
 * 放在 web-core：分層與「app 怎麼接上 web-core」的約定由它定義（docs/architecture/frontend/17-shared-packages.md §3）。
 */

/** monorepo 的根目錄。 */
export const REPO_ROOT = resolve(__dirname, '../../../..');

/** 只有原始碼、由 app 編譯的 package，由下而上（docs/coding-standards/07-layer-dependencies.md §1）。 */
export const FRONTEND_PACKAGES = ['web-shared', 'ui', 'web-core'] as const;
export type FrontendPackage = (typeof FRONTEND_PACKAGES)[number];

export interface SourceRoot {
  name: string;
  srcDir: string;
}

export function packageRoot(name: FrontendPackage): SourceRoot {
  return { name, srcDir: join(REPO_ROOT, 'packages', name, 'src') };
}

/** 以 web-core 建構的前端（`package.json` 依賴它）：不在這裡列名字，加第三個前端時自動納入。 */
export function frontendApps(): SourceRoot[] {
  const appsDir = join(REPO_ROOT, 'apps');
  return readdirSync(appsDir).flatMap((name) => {
    const manifest = join(appsDir, name, 'package.json');
    if (!existsSync(manifest)) return [];
    const { dependencies = {} } = JSON.parse(readFileSync(manifest, 'utf8')) as {
      dependencies?: Record<string, string>;
    };
    return '@b2b-system/web-core' in dependencies
      ? [{ name: `apps/${name}`, srcDir: join(appsDir, name, 'src') }]
      : [];
  });
}

/** `dir` 底下符合 `pattern` 的檔案（絕對路徑）。 */
export function sourceFiles(dir: string, pattern: RegExp): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return sourceFiles(full, pattern);
    return pattern.test(entry) ? [full] : [];
  });
}

/** 第幾行（1 起算）。 */
export function lineOf(source: string, index: number): number {
  return source.slice(0, index).split('\n').length;
}
