import { defineNotification } from '@/modules/notification/notification.definition';
import type { NotificationLink } from '@/modules/notification/notification.definition';

/**
 * 使用者的站內通知（docs/architecture/backend/15-notification.md §4、ADR-0026 D11）。
 * 參數是名稱快照：角色之後改名或被刪都不影響已送出的通知。
 */

/** 角色被指派或移除（`PUT /users/:id/roles`）：給被改的那個人。 */
export type UserRolesChangedParams = {
  /** 新增的角色名稱。 */
  added: string[];
  /** 移除的角色名稱。 */
  removed: string[];
};

export const USER_ROLES_CHANGED_NOTIFICATION =
  defineNotification<UserRolesChangedParams>('user.rolesChanged');

/** 自己的個人資料頁（前端 `/profile`）：看得到自己目前的角色，不需要任何權限。 */
export const ACCOUNT_PROFILE_LINK: NotificationLink = { route: 'account.profile', params: {} };
