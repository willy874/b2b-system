import { z } from 'zod';

export const DataTransferSearchQuerySchema = z.object({
  offset: z.coerce.number().int().min(0).catch(0),
  limit: z.coerce.number().int().min(1).max(100).catch(20),
  /** 從通知點進來時帶的傳輸 id（route id `dataTransfer.detail`）。 */
  transfer: z.string().uuid().optional().catch(undefined),
});

export type DataTransferSearchQuery = z.infer<typeof DataTransferSearchQuerySchema>;

/** 預設的查詢條件；與它相等的參數不寫進網址。 */
export const DEFAULT_DATA_TRANSFER_SEARCH: DataTransferSearchQuery = { offset: 0, limit: 20 };
