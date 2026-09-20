import { execSync } from 'node:child_process';

/**
 * 每次 E2E 跑之前把資料庫重置到已知狀態
 * （docs/frontend/10-testing.md §4.3）。
 */
export default function globalSetup(): void {
  if (process.env.E2E_SKIP_SEED === '1') return;
  const run = (script: string) =>
    execSync(`pnpm ${script}`, {
      cwd: new URL('../../', import.meta.url).pathname,
      stdio: 'inherit',
    });
  run('db:reset');
  run('db:seed');
  run('db:seed:e2e');
}
