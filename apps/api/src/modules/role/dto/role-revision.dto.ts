import { z } from 'zod';

import { defineSchema } from '@/core/validation';
import { RevisionSummarySchema } from '@/modules/revision/dto/revision.dto';

import { RoleRevisionSnapshotSchema } from '../role-revision';

/** `GET /roles/:id/revisions/:version`：一個版本 ＋ 快照（過大未保存時是 null）。 */
export const RoleRevisionSchema = defineSchema(
  'RoleRevision',
  RevisionSummarySchema.extend({
    snapshot: defineSchema('RoleRevisionSnapshot', RoleRevisionSnapshotSchema).nullable(),
  }),
);

/** `POST /roles/:id/revisions/:version/revert` 的請求本體。 */
export const RevertRoleRevisionSchema = defineSchema(
  'RevertRoleRevisionRequest',
  z.object({
    /**
     * 樂觀鎖：確認還原時看到的角色 `version`（必填，與 `PATCH /roles/:id` 相同）。與目前版本不同回 409
     * `ROLE_VERSION_CONFLICT`（`details.current`）。
     */
    version: z.number().int().min(1),
  }),
);

export type RoleRevisionDto = z.infer<typeof RoleRevisionSchema>;
export type RevertRoleRevisionDto = z.infer<typeof RevertRoleRevisionSchema>;
