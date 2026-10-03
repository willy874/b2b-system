import { readFileSync } from 'node:fs';
import { join, posix, relative, resolve } from 'node:path';

import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const API_ROOT = resolve(__dirname, '../..');

interface NestCliConfig {
  sourceRoot: string;
  compilerOptions: { assets: Array<{ include: string; outDir: string }> };
}

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(join(API_ROOT, path), 'utf8')) as T;
}

/**
 * Nest CLI 12 起，asset 的目的地 = `outDir` ＋ 檔案相對於 tsconfig `rootDir`（不是 `sourceRoot`）的路徑
 * （nestjs/nest-cli#3387）。`rootDir` 是 `./` 時 `src/` 會留在相對路徑裡：`outDir` 寫成 `dist/src`，
 * migration 會落在 `dist/src/src/db/...`，從 dist 啟動的 api（Dockerfile、`node dist/src/main`）找不到 SQL，
 * migrate 與新租戶的佈建都會失敗。
 */
describe('nest build 的 asset（migration 的 SQL 要落在 db/provision.ts 讀的 dist/src/db/...）', () => {
  const nest = readJson<NestCliConfig>('nest-cli.json');
  // tsconfig 允許註解：用 TypeScript 自己的解析器
  const tsconfig = ts.readConfigFile(join(API_ROOT, 'tsconfig.json'), ts.sys.readFile);
  const { compilerOptions } = tsconfig.config as { compilerOptions: { rootDir: string } };

  it.each([
    ['src/db/migrations/0000_baseline.sql', 'dist/src/db/migrations/0000_baseline.sql'],
    ['src/db/migrations/meta/_journal.json', 'dist/src/db/migrations/meta/_journal.json'],
    [
      'src/db/platform/migrations/0000_baseline.sql',
      'dist/src/db/platform/migrations/0000_baseline.sql',
    ],
    [
      'src/db/platform/migrations/meta/_journal.json',
      'dist/src/db/platform/migrations/meta/_journal.json',
    ],
  ])('%s → %s', (source, expected) => {
    const asset = nest.compilerOptions.assets.find((item) =>
      posix.matchesGlob(source, posix.join(nest.sourceRoot, item.include)),
    );
    expect(asset).toBeDefined();
    const fromRootDir = relative(join(API_ROOT, compilerOptions.rootDir), join(API_ROOT, source));
    expect(posix.join(asset!.outDir, fromRootDir.split('\\').join('/'))).toBe(expected);
  });
});
