import type { PlatformScriptDatabase } from './connect';
import { PRODUCTION_ENVIRONMENT, platformEnvironment } from './platform/schema';

/** 本機與開發用 compose 的 DB 主機；其他主機都要明確確認。 */
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', 'postgres']);

export interface DisposableTarget {
  /** 執行的指令，用在錯誤訊息（例：`db:reset`）。 */
  script: string;
  /** 平台 DB 的連線字串。 */
  platformUrl: string;
  /** 這次會動到的租戶 DB 的連線字串。 */
  tenantUrls: readonly string[];
}

export interface DisposableContext {
  nodeEnv: string | undefined;
  /** 平台 DB 的環境標記（`platform_environment.name`）；沒有標記是 undefined。 */
  environment: string | undefined;
  /** `--confirm <平台 database 名稱>` 的值。 */
  confirm: string | undefined;
}

export function databaseNameOf(url: string): string {
  return decodeURIComponent(new URL(url).pathname.slice(1));
}

/** `--confirm <值>` 的值；沒有就是 undefined。 */
export function confirmArgument(argv: readonly string[]): string | undefined {
  const index = argv.indexOf('--confirm');
  return index >= 0 ? argv[index + 1] : undefined;
}

/**
 * 會清空資料或寫入測試資料的腳本能不能對這些 DB 執行；不能時回傳原因（docs/architecture/backend/02-database.md §6.1）。
 *
 * 1. 執行者的 `NODE_ENV` 是 production：拒絕。
 * 2. 目標平台 DB 標記為 production：拒絕，任何參數都不能略過。看的是目標 DB，不是執行者的 shell——
 *    開發機帶著正式環境的連線字串（tunnel、臨時改過的 `.env`）時，前一條擋不住。
 * 3. 要動到的 DB 有任何一個不在本機：要加 `--confirm <平台 database 名稱>`。
 */
export function disposableRejection(
  target: DisposableTarget,
  context: DisposableContext,
): string | undefined {
  if (context.nodeEnv === 'production') return `${target.script} 不可在 production 執行`;
  if (context.environment === PRODUCTION_ENVIRONMENT) {
    return `${target.script} 拒絕執行：平台 DB 標記為 production（platform_environment）`;
  }
  const remote = [target.platformUrl, ...target.tenantUrls].filter(
    (url) => !LOCAL_HOSTS.has(new URL(url).hostname),
  );
  const platformDatabase = databaseNameOf(target.platformUrl);
  if (remote.length && context.confirm !== platformDatabase) {
    const hosts = [...new Set(remote.map((url) => new URL(url).host))].join(', ');
    return (
      `${target.script} 要動到不在本機的資料庫（${hosts}）。` +
      `確定要對它執行時，加上 --confirm ${platformDatabase}`
    );
  }
  return undefined;
}

/** 讀平台 DB 的環境標記；表還不存在（舊版的平台 DB）時視為沒有標記。 */
export async function readPlatformEnvironment(
  platform: PlatformScriptDatabase,
): Promise<string | undefined> {
  try {
    const [row] = await platform
      .select({ name: platformEnvironment.name })
      .from(platformEnvironment)
      .limit(1);
    return row?.name;
  } catch (error) {
    const code = (error as { cause?: { code?: string } }).cause?.code;
    if (code === '42P01') return undefined;
    throw error;
  }
}

/** 在任何寫入之前呼叫：目標不能清空時拋錯。 */
export async function assertDisposableDatabases(
  platform: PlatformScriptDatabase,
  target: DisposableTarget,
  argv: readonly string[] = process.argv.slice(2),
): Promise<void> {
  const rejection = disposableRejection(target, {
    nodeEnv: process.env.NODE_ENV,
    environment: await readPlatformEnvironment(platform),
    confirm: confirmArgument(argv),
  });
  if (rejection) throw new Error(rejection);
}

/** production 的 `db:migrate` 呼叫：標記這個平台 DB 是正式環境（冪等）。 */
export async function markProductionEnvironment(platform: PlatformScriptDatabase): Promise<void> {
  await platform
    .insert(platformEnvironment)
    .values({ name: PRODUCTION_ENVIRONMENT })
    .onConflictDoUpdate({ target: platformEnvironment.id, set: { name: PRODUCTION_ENVIRONMENT } });
}
