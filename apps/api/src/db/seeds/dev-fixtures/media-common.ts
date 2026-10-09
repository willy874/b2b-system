import { sql } from 'drizzle-orm';

import type { ScriptDatabase } from '../../client';
import { fileStorageUsage, jobOutbox } from '../../schema';

/** seed 腳本的交易（`db.transaction` 的參數）。 */
export type ScriptTransaction = Parameters<Parameters<ScriptDatabase['transaction']>[0]>[0];
export type ScriptDbOrTx = ScriptDatabase | ScriptTransaction;

/**
 * 圖片與檔案的處理交給正在跑的 api worker，seed 不自己產生變體。工作的名稱與 payload 要與各模組的定義相同：
 * `modules/gallery/gallery-process.job.ts`、`modules/image/image-process.job.ts`、`modules/file/file-image.service.ts`
 * （後者是要注入的 service，seed 不 import，docs/coding-standards/07-layer-dependencies.md §3.2 註 3；單元測試對照名稱）。
 */
export const SEED_JOB = {
  GALLERY_PROCESS: 'gallery.process',
  IMAGE_PROCESS: 'image.process',
  FILE_IMAGE_VARIANTS: 'file.imageVariants',
} as const;
export type SeedJobName = (typeof SEED_JOB)[keyof typeof SEED_JOB];

/**
 * 在租戶 DB 的 `job_outbox` 入列（docs/architecture/05-tenancy.md §10.2 D15）：與 `JobQueue.enqueue(…, { tx })` 寫的列相同。
 * seed 沒有 api 的「提交後立即搬移」，由 api 的定期清掃（`JOBS_OUTBOX_SWEEP_CRON`，預設每 10 分鐘）搬進佇列。
 */
export async function enqueueOutbox(
  tx: ScriptDbOrTx,
  name: SeedJobName,
  payloads: readonly Record<string, unknown>[],
): Promise<void> {
  if (payloads.length === 0) return;
  await tx.insert(jobOutbox).values(payloads.map((data) => ({ name, data, options: {} })));
}

/** 計入租戶容量（與檔案、圖片資產、圖片庫共用的 `file_storage_usage`，docs/architecture/backend/09-file.md §5.0）。 */
export async function addSeedStorageUsage(tx: ScriptDbOrTx, bytes: number): Promise<void> {
  if (bytes <= 0) return;
  await tx
    .insert(fileStorageUsage)
    .values({ id: true, usedBytes: bytes })
    .onConflictDoUpdate({
      target: fileStorageUsage.id,
      set: { usedBytes: sql`${fileStorageUsage.usedBytes} + ${bytes}` },
    });
}
