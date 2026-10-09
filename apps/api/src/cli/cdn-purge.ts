import { eq } from 'drizzle-orm';

import { cdnPathOf, NginxCdnEdgePurger } from '@/core/storage';
import type { CdnPurgeNodeResult, CdnPurgeTarget } from '@/core/storage';
import {
  createPlatformScriptClient,
  createScriptClient,
  listScriptTenants,
  loadScriptEnv,
} from '@/db/client';
import type { PlatformScriptDatabase } from '@/db/client';
import { platformAuditLogs, tenants } from '@/db/platform/schema';
import { files, galleryItems, imageAssets } from '@/db/schema';
import { confirmArgument, databaseNameOf, remoteRejection } from '@/db/script-guard';
import { fileVariantKeysOf } from '@/modules/file/file.constants';
import { galleryCdnKeysOf } from '@/modules/gallery/gallery.constants';
import { assetObjectKeysOf } from '@/modules/image/image.constants';

/**
 * 手動清理邊緣快取（docs/architecture/backend/09-file.md §16.7）：緊急下架（法律要求、誤傳個資）、
 * 重新打開 CDN 之前清掉關閉期間的殘留（§16.4）。同步執行，不經佇列；逐節點顯示結果。
 *
 *   pnpm --filter @b2b-system/api cli:cdn-purge --tenant <代碼> --path images/<id>/r3/sm.webp [--path …]
 *   pnpm --filter @b2b-system/api cli:cdn-purge --tenant <代碼> --image-asset <id>
 *   pnpm --filter @b2b-system/api cli:cdn-purge --tenant <代碼> --file <id>
 *   pnpm --filter @b2b-system/api cli:cdn-purge --tenant <代碼> --gallery-item <id>
 *   pnpm --filter @b2b-system/api cli:cdn-purge --all [--confirm <平台 database 名稱>]
 *
 * `--all` 不加 `--confirm` 只列出會影響哪些節點。平台 DB 不在本機時，任何形式都要 `--confirm <平台 database 名稱>`
 * （與 `cli:reset-super-admin` 相同）。寫平台稽核 `cdn.purge`（操作者是 system）。
 * 清理端點與密鑰讀 `FILE_CDN_PURGE_URL`、`FILE_CDN_PURGE_SECRET`（與 worker 相同的值）。
 *
 * 依資源列出路徑與 apps/platform 的手動清理（`CdnPathResolver`，§16.11）用同一組純函式（`assetObjectKeysOf`、
 * `fileVariantKeysOf`）：這支指令不啟動 Nest，所以不經過註冊表，但兩邊列出的路徑一致。
 */

/** 寫進平台稽核的 action。 */
export const CDN_PURGE_ACTION = 'cdn.purge';

const USAGE =
  '用法：cli:cdn-purge (--tenant <租戶代碼> (--path <物件 key>… | --image-asset <id> | --file <id> | --gallery-item <id>) | --all) ' +
  '[--confirm <平台 database 名稱>]';

export type CdnPurgeRequest =
  | { kind: 'paths'; tenant: string; keys: string[]; confirm?: string }
  | { kind: 'imageAsset'; tenant: string; assetId: string; confirm?: string }
  | { kind: 'file'; tenant: string; fileId: string; confirm?: string }
  | { kind: 'galleryItem'; tenant: string; itemId: string; confirm?: string }
  | { kind: 'all'; confirm?: string };

function valuesOf(argv: readonly string[], flag: string): string[] {
  const values: string[] = [];
  argv.forEach((arg, index) => {
    const value = argv[index + 1];
    if (arg === flag && value && !value.startsWith('--')) values.push(value.trim());
  });
  return values;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** 解析指令列；用法不對時拋錯（訊息帶用法）。 */
export function parseCdnPurgeArgs(argv: readonly string[]): CdnPurgeRequest {
  const confirm = confirmArgument(argv);
  const tenant = valuesOf(argv, '--tenant')[0];
  const keys = valuesOf(argv, '--path');
  const assetId = valuesOf(argv, '--image-asset')[0];
  const fileId = valuesOf(argv, '--file')[0];
  const itemId = valuesOf(argv, '--gallery-item')[0];
  if (argv.includes('--all')) {
    if (tenant || keys.length || assetId || fileId || itemId) {
      throw new Error(`--all 不能與其他對象一起用。${USAGE}`);
    }
    return { kind: 'all', confirm };
  }
  if (!tenant) throw new Error(`缺少 --tenant（或用 --all）。${USAGE}`);
  const targets = [keys.length > 0, Boolean(assetId), Boolean(fileId), Boolean(itemId)];
  if (targets.filter(Boolean).length !== 1) {
    throw new Error(`--path、--image-asset、--file、--gallery-item 要指定其中一種。${USAGE}`);
  }
  if (itemId) {
    if (!UUID.test(itemId))
      throw new Error(`--gallery-item 要是圖片庫的圖片 id（uuid）：${itemId}`);
    return { kind: 'galleryItem', tenant, itemId, confirm };
  }
  if (assetId) {
    if (!UUID.test(assetId)) throw new Error(`--image-asset 要是圖片資產的 id（uuid）：${assetId}`);
    return { kind: 'imageAsset', tenant, assetId, confirm };
  }
  if (fileId) {
    if (!UUID.test(fileId)) throw new Error(`--file 要是檔案的 id（uuid）：${fileId}`);
    return { kind: 'file', tenant, fileId, confirm };
  }
  // 物件 key 是 bucket 裡的相對路徑：前面的 / 拿掉，.. 不接受（不能藉此清到別的 bucket）
  const normalized = keys.map((key) => key.replace(/^\/+/, ''));
  const bad = normalized.find((key) => key === '' || key.split('/').includes('..'));
  if (bad !== undefined) throw new Error(`不合法的物件 key：${bad}`);
  return { kind: 'paths', tenant, keys: normalized, confirm };
}

export interface CdnPurgeOutcome {
  /** 送出的路徑數；`--all` 是 `'all'`；只列出節點（沒有 `--confirm` 的 `--all`）是 `undefined`。 */
  paths: number | 'all' | undefined;
  nodes: CdnPurgeNodeResult[] | string[];
  /** 只列出節點，沒有真的清理。 */
  dryRun: boolean;
}

function edgeFromEnv(env: NodeJS.ProcessEnv): NginxCdnEdgePurger {
  const url = env.FILE_CDN_PURGE_URL;
  const secret = env.FILE_CDN_PURGE_SECRET;
  if (!url || !URL.canParse(url))
    throw new Error('FILE_CDN_PURGE_URL 未設定或不是網址（例：http://cdn-purge:8081）');
  const key = secret ? Buffer.from(secret, 'base64') : Buffer.alloc(0);
  if (key.length < 32) throw new Error('FILE_CDN_PURGE_SECRET 未設定或解開後不到 32 bytes');
  const timeoutMs = Number(env.FILE_CDN_PURGE_TIMEOUT_MS ?? 5000);
  return new NginxCdnEdgePurger({
    purgeUrl: url,
    secret: key,
    timeoutMs: Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 5000,
  });
}

/** 一次請求最多送幾個路徑（與 `FILE_CDN_PURGE_BATCH_SIZE` 的上限相同）。 */
const CLI_BATCH = 1000;

/** 執行清理並寫稽核；不印東西（`main` 負責輸出）。 */
export async function runCdnPurge(
  request: CdnPurgeRequest,
  env: NodeJS.ProcessEnv = process.env,
  edge: NginxCdnEdgePurger = edgeFromEnv(env),
): Promise<CdnPurgeOutcome> {
  const platformUrl = env.PLATFORM_DATABASE_URL;
  if (!platformUrl) throw new Error('PLATFORM_DATABASE_URL 未設定');
  const platform = createPlatformScriptClient(platformUrl);
  try {
    if (request.kind === 'all') {
      const rejection = remoteRejection(
        { script: 'cli:cdn-purge', platformUrl, tenantUrls: [] },
        request.confirm,
      );
      if (rejection) throw new Error(rejection);
      // 本機也要明確確認：整個快取清掉之後，所有圖片都要重新回源
      if (request.confirm !== databaseNameOf(platformUrl)) {
        return { paths: undefined, nodes: await edge.nodes(), dryRun: true };
      }
      const nodes = await edge.purge({ all: true });
      await audit(platform.db, null, 'all', nodes);
      return { paths: 'all', nodes, dryRun: false };
    }

    const [tenant] = await listScriptTenants(platform.db, { code: request.tenant });
    if (!tenant) throw new Error(`找不到租戶 ${request.tenant}`);
    const rejection = remoteRejection(
      { script: 'cli:cdn-purge', platformUrl, tenantUrls: [tenant.databaseUrl] },
      request.confirm,
    );
    if (rejection) throw new Error(rejection);
    const [registered] = await platform.db
      .select({ bucket: tenants.storageBucket })
      .from(tenants)
      .where(eq(tenants.id, tenant.id));
    if (!registered) throw new Error(`找不到租戶 ${request.tenant} 的 bucket`);
    const keys =
      request.kind === 'paths'
        ? request.keys
        : request.kind === 'imageAsset'
          ? await imageAssetKeys(tenant.databaseUrl, request.assetId)
          : request.kind === 'file'
            ? await fileKeys(tenant.databaseUrl, request.fileId)
            : await galleryItemKeys(tenant.databaseUrl, request.itemId);
    const paths = [...new Set(keys)].map((key) => cdnPathOf(registered.bucket, key));
    const nodes: CdnPurgeNodeResult[] = [];
    for (let start = 0; start < paths.length; start += CLI_BATCH) {
      const target: CdnPurgeTarget = { paths: paths.slice(start, start + CLI_BATCH) };
      // oxlint-disable-next-line no-await-in-loop -- 一批送完再送下一批，失敗時看得出是哪一批
      nodes.push(...(await edge.purge(target)));
    }
    await audit(platform.db, tenant.code, paths.length, nodes);
    return { paths: paths.length, nodes, dryRun: false };
  } finally {
    await platform.client.end();
  }
}

async function imageAssetKeys(databaseUrl: string, assetId: string): Promise<string[]> {
  const { client, db } = createScriptClient(databaseUrl);
  try {
    const [row] = await db.select().from(imageAssets).where(eq(imageAssets.id, assetId));
    if (!row) {
      throw new Error(
        `找不到圖片資產 ${assetId}：已經永久刪除時改用 --path 指定物件 key（或 --all）`,
      );
    }
    return assetObjectKeysOf(row);
  } finally {
    await client.end();
  }
}

async function fileKeys(databaseUrl: string, fileId: string): Promise<string[]> {
  const { client, db } = createScriptClient(databaseUrl);
  try {
    // 回收桶裡的檔案也算：這裡故意不加 notDeleted()
    const [row] = await db.select({ id: files.id }).from(files).where(eq(files.id, fileId));
    if (!row) {
      throw new Error(`找不到檔案 ${fileId}：已經永久刪除時改用 --path 指定物件 key（或 --all）`);
    }
    return fileVariantKeysOf(row.id);
  } finally {
    await client.end();
  }
}

async function galleryItemKeys(databaseUrl: string, itemId: string): Promise<string[]> {
  const { client, db } = createScriptClient(databaseUrl);
  try {
    const [row] = await db.select().from(galleryItems).where(eq(galleryItems.id, itemId));
    if (!row) {
      throw new Error(
        `找不到圖片庫的圖片 ${itemId}：已經永久刪除時改用 --path 指定物件 key（或 --all）`,
      );
    }
    return galleryCdnKeysOf(row);
  } finally {
    await client.end();
  }
}

async function audit(
  db: PlatformScriptDatabase,
  tenant: string | null,
  paths: number | 'all',
  nodes: readonly CdnPurgeNodeResult[],
): Promise<void> {
  const failed = nodes.some((node) => node.result !== 'ok');
  await db.insert(platformAuditLogs).values({
    action: CDN_PURGE_ACTION,
    actorEmail: 'system',
    resourceType: 'cdn',
    resourceId: tenant,
    result: failed ? 'failure' : 'success',
    metadata: {
      via: 'cli',
      tenant,
      paths,
      nodes: nodes.map((node) => ({ address: node.address, result: node.result })),
    },
  });
}

async function main(): Promise<void> {
  loadScriptEnv();
  const request = parseCdnPurgeArgs(process.argv.slice(2));
  const outcome = await runCdnPurge(request);
  if (outcome.dryRun) {
    console.warn(
      `\n=== 清空整個邊緣快取（尚未執行） ===\n  會送到這些節點：${(outcome.nodes as string[]).join('、')}\n` +
        `  確定要執行時加上 --confirm ${databaseNameOf(process.env.PLATFORM_DATABASE_URL ?? '')}\n`,
    );
    return;
  }
  const nodes = outcome.nodes as CdnPurgeNodeResult[];
  const lines = nodes.map(
    (node) =>
      `  ${node.result === 'ok' ? '✓' : '✗'} ${node.address}：${node.result}` +
      (node.result === 'ok' && node.purged !== undefined
        ? `（刪掉 ${node.purged}、本來就不在 ${node.missing ?? 0}）`
        : node.detail
          ? `（${node.detail}）`
          : ''),
  );
  console.warn(
    `\n=== 邊緣快取的清理（${outcome.paths === 'all' ? '整個快取' : `${outcome.paths} 個路徑`}） ===\n` +
      `${lines.join('\n')}\n  已寫入平台稽核（${CDN_PURGE_ACTION}）。\n`,
  );
  if (nodes.some((node) => node.result !== 'ok')) process.exitCode = 1;
}

if (require.main === module) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
