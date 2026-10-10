import { z } from 'zod/mini';

import { AuditResourceType } from '@/shared/api-sdk';

import { AUDIT_LOG_MAX_OFFSET } from '../constants';

export const AuditLogSearchQuerySchema = z.object({
  // 超過列表的 offset 上限（後端回 400）時回到第一頁，不留在錯誤畫面
  offset: z.catch(
    z.coerce.number().check(z.int(), z.minimum(0), z.maximum(AUDIT_LOG_MAX_OFFSET)),
    0,
  ),
  limit: z.catch(z.coerce.number().check(z.int(), z.minimum(1), z.maximum(100)), 50),
  action: z.catch(z.optional(z.string().check(z.trim())), undefined),
  // 後端只收已知的類型（`AuditResourceType`）：網址帶了不認得的值就當沒篩選，不送出會 400 的請求
  resourceType: z.catch(
    z.optional(
      z.enum(Object.values(AuditResourceType) as [AuditResourceType, ...AuditResourceType[]]),
    ),
    undefined,
  ),
  result: z.catch(z.optional(z.enum(['success', 'failure'])), undefined),
  from: z.catch(z.optional(z.string()), undefined),
  to: z.catch(z.optional(z.string()), undefined),
});

export type AuditLogSearchQuery = z.infer<typeof AuditLogSearchQuerySchema>;

/** 預設的查詢條件；與它相等的參數不寫進網址（`stripSearchParams`，見 routes/pages.ts）。 */
export const DEFAULT_AUDIT_LOG_SEARCH: AuditLogSearchQuery = {
  offset: 0,
  limit: 50,
};
