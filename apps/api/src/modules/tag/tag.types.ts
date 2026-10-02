import type { AuthUser } from '@/common/types';
import type { TenantFeature } from '@/core/tenant';

/**
 * 一個標籤組（docs/adr/0032-tags.md D1）：由擁有者模組在 `onModuleInit` 以 `TagService.registerScope()` 登記。
 * 例：`file`（檔案與資料夾）、`user`（使用者）。
 */
export interface TagScopeDefinition {
  /** camelCase；同時存在 `tags.scope`，已發布後不改名。 */
  scope: string;
  /** 所屬的可啟用 feature：租戶沒啟用時這個標籤組回 `404 FEATURE_DISABLED`（D12）。 */
  feature?: TenantFeature;
  /** 進得了這個標籤組（讀得到定義）：通常是「能看這種資源的列表」的權限（D5）。 */
  canBrowse(actor: AuthUser): Promise<boolean>;
}

/** 擁有者判斷「能不能改這個資源的標籤」之後回傳的資訊。 */
export interface EditableTagTarget {
  /** 稽核用的名稱（檔名、資料夾名、使用者的 email）。 */
  name: string;
}

/**
 * 一種可以貼標籤的資源（D7）：由擁有者模組以 `TagService.registerResource()` 登記。
 * 指派的端點是通用的，權限判斷與推播都交給它。
 */
export interface TagResourceDefinition {
  /** `core/resource` 的 `RESOURCE_TYPE`（與 `resource_tags.resource_type`、稽核的 `resource_type` 相同）。 */
  resourceType: string;
  scope: string;
  /**
   * 能不能改這個資源的標籤：不存在或看不到 → 拋 `<RESOURCE>_NOT_FOUND`；看得到但不能改 → 拋 `AUTHZ_FORBIDDEN`。
   * 規則跟著目標的編輯權限（檔案、資料夾：能改名；使用者：`user:update`）。
   */
  resolveEditable(actor: AuthUser, resourceId: string): Promise<EditableTagTarget>;
  /** 交易提交後：擁有者推自己的資源變更（受眾等於目標的受眾，D10）。 */
  afterTagsChanged(resourceId: string): void | Promise<void>;
}
