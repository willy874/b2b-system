import type { PermissionKey } from '@/core/permission/enums';
import { create } from '@/shared/hooks';

interface PermissionStore {
  /** 平台範圍的權限（`/auth/profile`）已水合。 */
  hydrated: boolean;
  /** 目前工作區的權限（`/workspaces/:id/me`）已水合；不在工作區頁面時為 false。 */
  workspaceHydrated: boolean;
  /** `can()` 判斷用的集合：平台的鍵 ∪ 目前工作區的鍵（docs/adr/0018-workspace-tenancy.md D17）。 */
  permissions: Set<PermissionKey>;
  platformPermissions: readonly PermissionKey[];
  workspacePermissions: readonly PermissionKey[];
  setPermissions: (keys: readonly PermissionKey[]) => void;
  setWorkspacePermissions: (keys: readonly PermissionKey[]) => void;
  /** 離開工作區（或切換中）：只剩平台的鍵。 */
  clearWorkspacePermissions: () => void;
  clear: () => void;
}

const union = (a: readonly PermissionKey[], b: readonly PermissionKey[]) => new Set([...a, ...b]);

/**
 * 伺服器狀態原則上不進 store，權限集合是唯一的例外：
 * `can(key)` 出現在渲染路徑上，必須能同步讀取。
 */
export const usePermissionStore = create<PermissionStore>((set, get) => ({
  hydrated: false,
  workspaceHydrated: false,
  permissions: new Set<PermissionKey>(),
  platformPermissions: [],
  workspacePermissions: [],
  // 每次都建新的 Set：store 用參照比較決定是否通知訂閱者
  setPermissions: (keys) =>
    set({
      platformPermissions: keys,
      permissions: union(keys, get().workspacePermissions),
      hydrated: true,
    }),
  setWorkspacePermissions: (keys) =>
    set({
      workspacePermissions: keys,
      permissions: union(get().platformPermissions, keys),
      workspaceHydrated: true,
    }),
  clearWorkspacePermissions: () =>
    set({
      workspacePermissions: [],
      permissions: new Set(get().platformPermissions),
      workspaceHydrated: false,
    }),
  clear: () =>
    set({
      permissions: new Set<PermissionKey>(),
      platformPermissions: [],
      workspacePermissions: [],
      hydrated: false,
      workspaceHydrated: false,
    }),
}));
