import { PermissionKey, usePermission } from '@/core/permission';

/**
 * 共用對話框的「檢查存取」（ADR-0024 G4b）：看別人為什麼能（不能）存取，要 `authz:explain`。
 * 與目前位置無關、也不依賴頁面權限的註冊，所以不放進 `useFilePermission`。未水合時為 false（不閃現）。
 */
export function useFileExplainPermission() {
  const { can, hydrated } = usePermission();
  return { canExplain: hydrated && can(PermissionKey['authz:explain']) };
}
