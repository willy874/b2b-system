import { z } from 'zod';

import type { Database, Transaction } from '@/core/database';
import { withTransaction } from '@/core/database';
import { AppException } from '@/core/errors';
import type { ErrorCode } from '@/core/errors';
import { getRequestContext, runWithRequestContext } from '@/core/http';
import { defineSchema } from '@/core/validation';

/** 一次批次最多幾筆：與分頁 `limit` 的上限相同，讓「在一頁全選」一定送得出去（ADR-0009 D7）。 */
export const BATCH_MAX_SIZE = 200;

/** 批次端點的 `ids`：1–200 筆、不可重複。其他參數以 `.extend()` 並列。 */
export const BatchIdsSchema = defineSchema(
  'BatchIdsRequest',
  z.object({
    ids: z
      .array(z.string().uuid())
      .min(1)
      .max(BATCH_MAX_SIZE)
      .refine((ids) => new Set(ids).size === ids.length, { message: 'ids must be unique' }),
  }),
);

export type BatchIdsDto = z.infer<typeof BatchIdsSchema>;

export const BatchFailureSchema = defineSchema(
  'BatchFailure',
  z.object({
    id: z.string().uuid(),
    code: z.string(),
    details: z.record(z.string(), z.unknown()).optional(),
  }),
);

export const BatchResultSchema = defineSchema(
  'BatchResult',
  z.object({
    succeeded: z.array(z.string().uuid()),
    failed: z.array(BatchFailureSchema),
  }),
);

export interface BatchFailure {
  id: string;
  code: ErrorCode;
  details?: Record<string, unknown>;
}

/** 批次端點的回應：各自依請求的 `ids` 順序排列。 */
export interface BatchResult {
  succeeded: string[];
  failed: BatchFailure[];
}

/**
 * 一筆的處理步驟，對應單筆方法拆出的三段（ADR-0009 §D3／D4）。
 * 每筆都是「檢查 → 交易（含稽核）→ 快取失效」，事件整批結束後一次發佈。
 */
export interface BatchSteps<TPlan> {
  /**
   * 交易前的業務檢查；不通過就拋 `AppException`（記進 `failed`）。
   * 回傳 `null` 代表目標已經是結果狀態：算成功，但不寫入、不稽核、不發事件（ADR-0009 D9）。
   */
  prepare: (id: string) => Promise<TPlan | null>;
  /** 寫入與稽核，在這一筆自己的交易內。 */
  apply: (plan: TPlan, tx: Transaction) => Promise<void>;
  /** 這一筆交易提交後的快取失效。 */
  invalidate: (plan: TPlan) => void;
  /**
   * 整批結束後，以所有實際寫入的 plan 發佈一次領域事件。
   * 可以是非同步的（例：審批 handler 的 `afterApply`），`runBatch` 會等它完成才回應。
   */
  publish: (plans: TPlan[]) => void | Promise<void>;
}

/**
 * 依 `ids` 的順序逐筆執行（不平行）：後一筆的檢查要看得到前一筆的結果，
 * 例如「最後一位 super-admin」。每筆一個交易，逐筆的 `AppException` 收進 `failed`。
 *
 * 非預期例外（DB 斷線等）直接往外拋、整批回 500；拋出前仍會為已提交的那幾筆發佈事件，
 * 其他人的畫面才不會停在舊資料。
 *
 * 執行期間請求 context 帶著 `batch`，讓稽核在 metadata 標記這一筆屬於批次（ADR-0009 D8）。
 */
export async function runBatch<TPlan>(
  db: Database,
  ids: readonly string[],
  steps: BatchSteps<TPlan>,
): Promise<BatchResult> {
  const result: BatchResult = { succeeded: [], failed: [] };
  const applied: TPlan[] = [];

  const run = async () => {
    try {
      for (const id of ids) {
        let plan: TPlan | null;
        try {
          // 刻意依序：後一筆的檢查要看得到前一筆提交後的狀態（ADR-0009 D3）
          // oxlint-disable-next-line no-await-in-loop
          plan = await steps.prepare(id);
          if (plan !== null) {
            const current = plan;
            // oxlint-disable-next-line no-await-in-loop -- 同上，每筆一個交易
            await withTransaction(db, (tx) => steps.apply(current, tx));
          }
        } catch (error) {
          if (!(error instanceof AppException)) throw error;
          result.failed.push(
            error.details === undefined
              ? { id, code: error.code }
              : { id, code: error.code, details: error.details },
          );
          continue;
        }
        if (plan !== null) {
          steps.invalidate(plan);
          applied.push(plan);
        }
        result.succeeded.push(id);
      }
    } finally {
      if (applied.length) await steps.publish(applied);
    }
    return result;
  };

  const context = getRequestContext();
  return context ? runWithRequestContext({ ...context, batch: { size: ids.length } }, run) : run();
}
