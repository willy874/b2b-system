/**
 * 跨模組的資源識別（docs/architecture/backend/14-revisions.md §9.2 D7）：回收桶、版本歷史、標籤／留言的 `resource_type`，
 * 與 `audit_logs.resource_type`、`relation_tuples.object_type` 是同一組字串（camelCase）。
 *
 * 用 text ＋ 這份常數，不用 Postgres enum：資源類型會持續增加，enum 每加一種就要一支 `ALTER TYPE` 的 migration。
 * 放在 `core/` 只是資料，不代表 core 認識這些模組（與 feature flag 目錄同一個理由）。已發布的值不改名。
 */
export const RESOURCE_TYPE = {
  USER: 'user',
  ROLE: 'role',
  GROUP: 'group',
  FILE: 'file',
  FILE_FOLDER: 'fileFolder',
  SERVICE_ACCOUNT: 'serviceAccount',
  API_TOKEN: 'apiToken',
  WEBHOOK: 'webhook',
  TAG: 'tag',
  ANNOUNCEMENT: 'announcement',
} as const;

export type ResourceType = (typeof RESOURCE_TYPE)[keyof typeof RESOURCE_TYPE];
