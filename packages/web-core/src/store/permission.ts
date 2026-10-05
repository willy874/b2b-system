import { create } from '@b2b-system/web-shared/hooks';

import type { PermissionKey } from '../permission/register';

interface PermissionStore {
  hydrated: boolean;
  permissions: Set<PermissionKey>;
  setPermissions: (keys: readonly PermissionKey[]) => void;
  clear: () => void;
}

/**
 * 伺服器狀態原則上不進 store，權限集合是唯一的例外：
 * `can(key)` 出現在渲染路徑上，必須能同步讀取。
 */
export const usePermissionStore = create<PermissionStore>((set) => ({
  hydrated: false,
  permissions: new Set<PermissionKey>(),
  // 每次都建新的 Set：store 用參照比較決定是否通知訂閱者
  setPermissions: (keys) => set({ permissions: new Set(keys), hydrated: true }),
  clear: () => set({ permissions: new Set<PermissionKey>(), hydrated: false }),
}));
