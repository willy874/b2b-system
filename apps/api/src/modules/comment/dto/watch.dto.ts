import { z } from 'zod';

import { defineSchema } from '@/core/validation';

/** 自己對一個資源的關注（docs/architecture/backend/24-comment.md §3.2）。 */
export const WatchStateSchema = defineSchema(
  'WatchState',
  z.object({
    watching: z.boolean(),
    /** 關注這個資源的人數（含自己）。 */
    watcherCount: z.number().int(),
  }),
);

export type WatchStateDto = z.infer<typeof WatchStateSchema>;
