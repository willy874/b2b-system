import { existsSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  FRONTEND_PACKAGES,
  frontendApps,
  lineOf,
  packageRoot,
  REPO_ROOT,
  sourceFiles,
} from './workspace';

/** 區塊註解與行註解（`://` 是網址，不算行註解）。 */
const COMMENT = /\/\*[\s\S]*?\*\/|(?<![:\\])\/\/[^\n]*/g;

/** 反引號括住、以 app 的資料夾開頭的路徑（`core/…`、`@/apis/…`；`themes/` 是搬走前的舊位置）。 */
const APP_PATH =
  /`(?:@\/)?((?:core|app|apis|features|plugins|shared|mocks|test|themes)\/[\w.$/-]+)`/g;

/** 反引號括住的 package 路徑：`web-core/<module>` 指 `packages/web-core/src/<module>`（docs/architecture/frontend/01-architecture.md §1）。 */
const PACKAGE_PATH = /`(web-core|ui|web-shared)\/([\w.$/-]+)`/g;

/** 從 repo 根目錄寫起的路徑，有沒有反引號都算。 */
const REPO_PATH = /(?<![\w./@-])((?:apps|packages|docs)\/[\w.$/-]*[\w$])/g;

const EXTENSIONS = ['', '.ts', '.tsx', '/index.ts', '/index.tsx'];

function existsUnder(bases: readonly string[], path: string): boolean {
  return bases.some((base) => EXTENSIONS.some((ext) => existsSync(join(base, path + ext))));
}

interface Reference {
  /** 在註解中的位置。 */
  offset: number;
  /** 註解裡寫的樣子。 */
  text: string;
  /** 相對於 `bases` 的路徑。 */
  path: string;
  /** 依序嘗試的目錄，任一個底下存在即可。 */
  bases: readonly string[];
}

function referencesIn(comment: string, appPathBases: readonly string[]): Reference[] {
  return [
    ...[...comment.matchAll(APP_PATH)].map(({ index, 0: text, 1: path = '' }) => ({
      offset: index,
      text,
      path,
      bases: appPathBases,
    })),
    ...[...comment.matchAll(PACKAGE_PATH)].map(({ index, 0: text, 1: pkg = '', 2: path = '' }) => ({
      offset: index,
      text,
      path,
      bases: [join(REPO_ROOT, 'packages', pkg, 'src')],
    })),
    ...[...comment.matchAll(REPO_PATH)].map(({ index, 1: path = '' }) => ({
      offset: index,
      text: path,
      path,
      bases: [REPO_ROOT],
    })),
  ];
}

describe('註解引用的路徑（docs/conventions/01-general.md §5）', () => {
  const apps = frontendApps();
  const roots = [
    // app 的註解：`core/…` 指自己的 src/（web-core 的寫成 `web-core/…`）
    ...apps.map(({ name, srcDir }) => ({ name, srcDir, appPathBases: [srcDir] })),
    // package 的註解：`app/…` 等可能是自己的模組，也可能指 app 的檔案（「app 的 `app/routes.tsx`」）
    ...FRONTEND_PACKAGES.map(packageRoot).map(({ name, srcDir }) => ({
      name,
      srcDir,
      appPathBases: [srcDir, ...apps.map((app) => app.srcDir)],
    })),
  ];

  it('掃得到依賴 web-core 的 app（測試本身有效）', () => {
    expect(apps.map((app) => app.name)).toContain('apps/backstage');
  });

  it('反引號括住的 app／package 路徑、從 repo 根目錄寫起的路徑都存在', () => {
    const missing = roots.flatMap(({ srcDir, appPathBases }) =>
      sourceFiles(srcDir, /\.(tsx?|css)$/).flatMap((file) => {
        const source = readFileSync(file, 'utf8');
        return [...source.matchAll(COMMENT)].flatMap((comment) =>
          referencesIn(comment[0], appPathBases)
            .filter(({ path, bases }) => !existsUnder(bases, path))
            .map(
              ({ offset, text }) =>
                `${relative(REPO_ROOT, file)}:${lineOf(source, comment.index + offset)} ${text}`,
            ),
        );
      }),
    );
    expect(missing, missing.join('\n')).toEqual([]);
  });
});
