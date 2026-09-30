import { execSync } from 'node:child_process';
import { rmSync } from 'node:fs';

import { SNAPSHOT_DIR } from './helpers/snapshot';

/**
 * 每次 E2E 跑之前清空關鍵快照（§4.5），並把資料庫重置到已知狀態
 * （docs/architecture/frontend/10-testing.md §4.3）。
 */
export default function globalSetup(): void {
  rmSync(SNAPSHOT_DIR, { recursive: true, force: true });
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
