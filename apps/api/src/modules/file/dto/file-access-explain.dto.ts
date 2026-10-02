import { z } from 'zod';

import { defineSchema } from '@/core/validation';
import { ExplainNodeSchema } from '@/modules/authz-explain/dto/authz-explain.dto';

import { FILE_ACTIONS } from '../file-access.context';

export const FileAccessExplainQuerySchema = z.object({ userId: z.string().uuid() });
export type FileAccessExplainQueryDto = z.infer<typeof FileAccessExplainQuerySchema>;

/** 某位使用者在這個資料夾上的每個動作：能不能做，能的話經由哪條路徑（docs/rbac/01-domain-model.md §9.3 D14 遮蔽）。 */
export const FileAccessExplainSchema = defineSchema(
  'FileAccessExplain',
  z.object({
    folderId: z.string().uuid(),
    userId: z.string().uuid(),
    actions: z.array(
      z.object({
        action: z.enum(FILE_ACTIONS),
        allowed: z.boolean(),
        /** 從使用者本人到這個動作的路徑；不能做時是 null。 */
        path: z.array(ExplainNodeSchema).nullable(),
      }),
    ),
  }),
);

export type FileAccessExplainDto = z.infer<typeof FileAccessExplainSchema>;
