import { z } from 'zod/mini';

/** `.catch()`：使用者手改網址成不合法的 id 時當作沒有選，不變成錯誤頁。 */
export const OrganizationSearchSchema = z.object({
  /** 右側顯示的部門（命令面板、使用者詳情以 route id `organization.unit` 連進來）。 */
  unitId: z.catch(z.optional(z.uuid()), undefined),
  /** 清單（部門樹＋詳情）或組織圖；預設清單。 */
  view: z.catch(z.optional(z.enum(['list', 'chart'])), undefined),
});

export type OrganizationSearch = z.infer<typeof OrganizationSearchSchema>;
