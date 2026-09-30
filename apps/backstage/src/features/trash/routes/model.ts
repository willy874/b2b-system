import { z } from 'zod';

export const TrashSearchQuerySchema = z.object({
  /** 目前的分頁（資源類型）；沒有或看不到時由頁面選第一個看得到的類型。 */
  type: z.string().optional().catch(undefined),
  offset: z.coerce.number().int().min(0).default(0).catch(0),
  limit: z.coerce.number().int().min(1).max(200).default(20).catch(20),
});

export type TrashSearchQuery = z.infer<typeof TrashSearchQuerySchema>;

/** 預設的查詢條件；與它相等的參數不寫進網址。 */
export const DEFAULT_TRASH_SEARCH: TrashSearchQuery = { offset: 0, limit: 20 };
