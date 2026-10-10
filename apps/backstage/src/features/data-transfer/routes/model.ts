import { z } from 'zod/mini';

export const DataTransferSearchQuerySchema = z.object({
  offset: z.catch(z.coerce.number().check(z.int(), z.minimum(0)), 0),
  limit: z.catch(z.coerce.number().check(z.int(), z.minimum(1), z.maximum(100)), 20),
  /** 從通知點進來時帶的傳輸 id（route id `dataTransfer.detail`）。 */
  transfer: z.catch(z.optional(z.uuid()), undefined),
});

export type DataTransferSearchQuery = z.infer<typeof DataTransferSearchQuerySchema>;

/** 預設的查詢條件；與它相等的參數不寫進網址。 */
export const DEFAULT_DATA_TRANSFER_SEARCH: DataTransferSearchQuery = { offset: 0, limit: 20 };
