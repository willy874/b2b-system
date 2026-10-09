import { z } from 'zod';

import { defineSchema } from '@/core/validation';

/**
 * 儲存的止水線（docs/architecture/backend/25-image.md §12 D8）：所有租戶最近一次量到的已用量合計與上限。
 * 只給平台管理者看；租戶被擋時的錯誤不帶這些數字。
 */
export const StorageTotalSchema = defineSchema(
  'StorageTotal',
  z.object({
    usedBytes: z.number(),
    /** 止水線（位元組）；`null` = 這個部署沒有啟用（`STORAGE_TOTAL_LIMIT_MB=0`）。 */
    limitBytes: z.number().nullable(),
    /** 已用量 ÷ 止水線；沒有啟用時為 `null`。 */
    usageRatio: z.number().nullable(),
    /** 越過這個比例時通知平台管理者，畫面標成警示。 */
    warningRatio: z.number(),
    /** 最近一次量測的時間；`null` = 還沒彙總過。 */
    measuredAt: z.string().nullable(),
    /** 量測太舊（背景工作停了），止水線暫時不擋。 */
    isStale: z.boolean(),
  }),
);

export type StorageTotalDto = z.infer<typeof StorageTotalSchema>;
