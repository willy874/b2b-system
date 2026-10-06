import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/** 讀 `.env` 裡一個變數的值（只處理 `KEY=value  # 註解` 這種單行寫法）。 */
function envFileValue(file: string, key: string): string | undefined {
  if (!existsSync(file)) return undefined;
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const match = new RegExp(`^\\s*${key}\\s*=\\s*(\\S*)`).exec(line);
    if (match) return match[1] || undefined;
  }
  return undefined;
}

function databaseNameOf(url: string | undefined): string | undefined {
  if (!url) return undefined;
  try {
    return decodeURIComponent(new URL(url).pathname.slice(1)) || undefined;
  } catch {
    // 不是網址：當成沒有指定，交給下面的錯誤訊息
    return undefined;
  }
}

/**
 * E2E 的 global setup 會先 `db:reset`，清空 `PLATFORM_DATABASE_URL` 與它登記的每個租戶 DB。
 * 沒有明確指定 E2E 用的 DB 就拒絕，避免清掉 `.env` 指向的共用開發 DB（docs/architecture/frontend/10-testing.md §4.3）：
 *
 * - 環境變數的 `PLATFORM_DATABASE_URL` 與 `.env` 的不同（隔離環境的做法）→ 放行；
 * - 確定要清空 `.env` 那一個：`E2E_RESET_CONFIRM=<平台 database 名稱>` → 放行。
 */
export function assertE2eDatabaseIsDisposable(rootDir: string): void {
  const fromFile = envFileValue(join(rootDir, '.env'), 'PLATFORM_DATABASE_URL');
  const explicit = process.env.PLATFORM_DATABASE_URL;
  if (explicit && explicit !== fromFile) return;
  const database = databaseNameOf(explicit ?? fromFile);
  if (database && process.env.E2E_RESET_CONFIRM === database) return;
  throw new Error(
    `E2E 會先 db:reset，清空平台 DB（${database ?? 'PLATFORM_DATABASE_URL 未設定'}）與它登記的每個租戶 DB。\n` +
      '  對隔離的暫用 DB 跑：export PLATFORM_DATABASE_URL=…（docs/architecture/frontend/10-testing.md §4.3）\n' +
      `  確定要清空 .env 指向的 DB：E2E_RESET_CONFIRM=${database ?? '<平台 database 名稱>'} pnpm test:e2e\n` +
      '  資料已經準備好、不需要重置：E2E_SKIP_SEED=1',
  );
}
