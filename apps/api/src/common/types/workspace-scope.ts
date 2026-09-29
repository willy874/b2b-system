declare const WORKSPACE_SCOPE: unique symbol;

/**
 * 通過工作區檢查的請求範圍（docs/adr/0018-workspace-tenancy.md D9、D10）。品牌型別：
 * 工作區範圍的 repository 方法第一個參數是它，隨手拿一個 id 字串傳不進去。
 */
export interface WorkspaceScope {
  readonly workspaceId: string;
  readonly [WORKSPACE_SCOPE]: true;
}

/**
 * 只給 `PermissionsGuard`（確認過成員資格之後）與系統工作（啟動時的整理、背景工作、
 * 已由 payload 得知工作區的審批 handler）使用；業務程式碼從 `@CurrentWorkspace()` 取得。
 */
export function workspaceScopeOf(workspaceId: string): WorkspaceScope {
  return { workspaceId } as WorkspaceScope;
}
