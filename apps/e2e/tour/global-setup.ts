import { execSync } from 'node:child_process';

/**
 * 導覽的起點：比 E2E 多跑一次 `db:seed:dev`，讓列表有 50 位使用者、9 個群組與數百筆稽核可看
 * （docs/architecture/frontend/10-testing.md §4.3 的隔離環境；不要對著共用 dev DB 跑）。
 */
export default function globalSetup(): void {
  if (process.env.E2E_SKIP_SEED === '1') return;
  const run = (script: string) =>
    execSync(`pnpm ${script}`, {
      cwd: new URL('../../../', import.meta.url).pathname,
      stdio: 'inherit',
    });
  run('db:reset');
  run('db:seed');
  run('db:seed:dev');
  run('db:seed:e2e');
}
