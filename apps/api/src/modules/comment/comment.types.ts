import type { ChangeSource } from '@b2b-system/realtime';

import type { AuthUser } from '@/common/types';
import type { TenantFeature } from '@/core/tenant';
import type { NotificationLink } from '@/modules/notification/notification.definition';
import type { PermissionCheckContext } from '@/modules/permission/permission.service';

/** 擁有者描述一個資源：通知的句子與連結用。 */
export interface CommentTarget {
  /** 顯示用的名稱快照（使用者的顯示名稱、檔名…），寫進通知的參數。 */
  name: string;
  /** 通知的快速連結（前端的 route id，docs/architecture/backend/15-notification.md §4.1）；null＝沒有。 */
  link: NotificationLink | null;
}

/**
 * 一種可以留言與關注的資源（docs/architecture/backend/24-comment.md §1、§8.2 D2）：由擁有者模組在 `onModuleInit` 以
 * `CommentService.registerResource()` 登記。留言與關注的端點是通用的，「看不看得到」由擁有者判斷。
 */
export interface CommentResourceDefinition {
  /** `core/resource` 的 `RESOURCE_TYPE`（與 `comments.resource_type`、`watches.resource_type` 相同），已發布後不改名。 */
  resourceType: string;
  /** 推播時 `refs` 用的來源：前端依它找到資源的頁面，後端依它決定受眾（docs/architecture/backend/08-realtime.md §6.1）。 */
  changeSource: ChangeSource;
  /** 所屬的可啟用 feature：租戶沒啟用時端點回 `404 FEATURE_DISABLED`，關注的通知也不送；資料保留。 */
  feature?: TenantFeature;
  /**
   * 看得到這個資源：不存在或看不到 → 拋 `<RESOURCE>_NOT_FOUND`；需要權限鍵時以 `PermissionService.assertHasAll` 帶 `context`
   * （拒絕要寫 `authz.denied`：留言的端點只宣告 `@Authenticated()`，這裡是唯一的權限檢查）。
   * 看得到就能讀留言、留言、關注（D3）。
   */
  resolveViewable(
    actor: AuthUser,
    resourceId: string,
    context: PermissionCheckContext,
  ): Promise<CommentTarget>;
  /** 沒有操作者時（背景工作）描述資源；已不存在（含軟刪除）回 `undefined`。 */
  describe(resourceId: string): Promise<CommentTarget | undefined>;
  /**
   * 這些人之中看得到這個資源的（批次）：@提及的候選、提及與關注的通知只送給他們（D6、D7）。
   * 傳入的 id 可能包含停用或刪除的人，擁有者照自己的規則判斷即可。
   */
  filterViewers(resourceId: string, userIds: readonly string[]): Promise<string[]>;
}
