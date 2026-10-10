import { z } from 'zod/mini';

/**
 * 列表頁網址的分頁欄位（route 的 search schema 以 `z.object({ ...paginationSearchShape(), … })` 組合）。
 * 網址上的值不合法（負數、不是整數、超過上限）時退回預設值，不讓頁面壞掉。
 *
 * @param defaultLimit 每頁筆數的預設值
 * @param maxLimit 每頁筆數的上限（與 api 的上限相同，預設 200）
 */
export function paginationSearchShape(defaultLimit = 20, maxLimit = 200) {
  return {
    offset: z.catch(z._default(z.coerce.number().check(z.int(), z.minimum(0)), 0), 0),
    limit: z.catch(
      z._default(z.coerce.number().check(z.int(), z.minimum(1), z.maximum(maxLimit)), defaultLimit),
      defaultLimit,
    ),
  };
}

/** 列表頁網址的關鍵字：去頭尾空白；不合法時當作沒有。 */
export const keywordSearchSchema = z.catch(z.optional(z.string().check(z.trim())), undefined);
