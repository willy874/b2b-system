/**
 * CI：這次新增的 migration 有沒有破壞性語句（docs/architecture/01-system.md §7 D14）。
 *
 *   MIGRATION_BASE=origin/main pnpm --filter @b2b-system/api migrations:check
 *
 * 比對 `MIGRATION_BASE...HEAD` 新增的 `src/db/migrations/*.sql` 與 `src/db/platform/migrations/*.sql`。
 * 沒設定 `MIGRATION_BASE` 時用 `origin/main`；base 找不到（淺層 clone）時失敗，不默默略過。
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { findBreakingChanges } from '../src/db/migration-compat';

const base = process.env.MIGRATION_BASE || 'origin/main';
const root = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
const added = execFileSync(
  'git',
  ['diff', '--name-only', '--diff-filter=A', `${base}...HEAD`, '--', 'apps/api/src/db'],
  { cwd: root, encoding: 'utf8' },
)
  .split('\n')
  .filter((path) => /\/migrations\/[^/]+\.sql$/.test(path));

const problems = added.flatMap((path) =>
  findBreakingChanges(path, readFileSync(resolve(root, path), 'utf8')),
);
for (const problem of problems) {
  console.error(`✗ ${problem.file}:${problem.line}  ${problem.rule}\n    ${problem.sql}`);
}
if (problems.length > 0) {
  console.error(
    '\n破壞性變更要拆成兩次部署（docs/architecture/backend/02-database.md §5.1）。確定這一句對上一版相容（例：第二次部署），' +
      '在它上方寫 `-- breaking-ok: <理由>`。',
  );
  process.exitCode = 1;
} else {
  console.log(`✓ 新增的 migration（${added.length} 份）沒有破壞性語句（base：${base}）`);
}
