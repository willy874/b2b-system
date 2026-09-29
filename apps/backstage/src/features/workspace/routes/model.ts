import { z } from 'zod';

/** 成員清單的網址參數：搜尋字與第幾頁（可分享、上一頁可還原）。 */
export const WorkspaceMemberSearchSchema = z.object({
  offset: z.coerce.number().int().min(0).default(0).catch(0),
  keyword: z.string().trim().max(100).optional().catch(undefined),
});

export type WorkspaceMemberSearch = z.infer<typeof WorkspaceMemberSearchSchema>;

export const DEFAULT_WORKSPACE_MEMBER_SEARCH: WorkspaceMemberSearch = { offset: 0 };
