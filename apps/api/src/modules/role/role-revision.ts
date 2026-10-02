import { z } from 'zod';

/**
 * 角色版本的快照（docs/architecture/backend/14-revisions.md §4、docs/architecture/backend/14-revisions.md §9.2 D1 的白名單）：只有可編輯的內容——
 * 名稱、說明與明確授予的權限鍵。不含 id、slug（不可變）、`is_system`、時間戳、`version`。
 *
 * 形狀改變時，舊的版本仍是舊的形狀：還原前以 `RoleRevisionSnapshotSchema` 驗證，對不上就當成無法還原。
 * 純函式（不依賴 DI）：`db/seeds` 建立系統角色時也用它寫第 1 版；migration 0014 的基準版本以 SQL 產生同一個形狀。
 */
export const RoleRevisionSnapshotSchema = z.object({
  name: z.string(),
  description: z.string().nullable(),
  /** 依 JS 的預設排序（UTF-16 碼位），兩版之間的差異才不會因為順序而出現。 */
  permissionKeys: z.array(z.string()),
});

export type RoleRevisionSnapshot = z.infer<typeof RoleRevisionSnapshotSchema>;

export function toRoleRevision(
  role: { name: string; description: string | null },
  permissionKeys: readonly string[],
): RoleRevisionSnapshot {
  return {
    name: role.name,
    description: role.description,
    permissionKeys: [...permissionKeys].toSorted(),
  };
}
