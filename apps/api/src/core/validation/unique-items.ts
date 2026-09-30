import type { z } from 'zod';

/**
 * 陣列不可有重複值。重複的 id 會讓複合主鍵的 INSERT 衝突，或讓「以 Set 比數量」的存在檢查誤判
 * ；在入口就回 `VALIDATION_FAILED`。
 */
export function uniqueItems<T extends z.ZodArray<z.ZodType>>(schema: T): T {
  return schema.refine((items) => new Set(items).size === items.length, {
    message: 'duplicate items',
  });
}
