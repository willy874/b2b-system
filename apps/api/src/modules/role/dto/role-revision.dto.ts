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
     * 樂觀鎖：確認還原時看到的角色 `version`。與目前版本不同回 409 `ROLE_VERSION_CONFLICT`（`details.current`）；
     * 不帶則後寫者勝（與 `PATCH /roles/:id` 相同，ADR-0025 D4 的 R1 選填）。
     */
    version: z.number().int().min(1).optional(),
  }),
);

export type RoleRevisionDto = z.infer<typeof RoleRevisionSchema>;
export type RevertRoleRevisionDto = z.infer<typeof RevertRoleRevisionSchema>;
