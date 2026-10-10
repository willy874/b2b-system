import { z } from 'zod/mini';

import type { TagScope } from '@/apis/tag/types';

export const TAG_SCOPES = ['file', 'user', 'gallery'] as const satisfies readonly TagScope[];

/** `.catch()`：手改網址成不認得的標籤組時退回第一個。 */
export const TagSearchQuerySchema = z.object({
  scope: z.catch(z.enum(TAG_SCOPES), 'file'),
});

export type TagSearchQuery = z.infer<typeof TagSearchQuerySchema>;

export const DEFAULT_TAG_SEARCH: TagSearchQuery = { scope: 'file' };
