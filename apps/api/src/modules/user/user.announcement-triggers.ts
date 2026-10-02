import { defineAnnouncementTrigger } from '@/modules/announcement/announcement.triggers';
import type { AnnouncementTriggerDefinition } from '@/modules/announcement/announcement.triggers';

/**
 * 帳號第一次可以登入（docs/architecture/backend/19-announcement.md §9.2 D14）：完成啟用（pending → active），或建立時就是 active
 * （外部 IdP 首次登入、管理者直接設密碼）。對「在公告受眾裡」的那個人發送——例：新人的入門指南。
 */
export const USER_ACTIVATED_TRIGGER = defineAnnouncementTrigger('user.activated', {
  scope: 'audience',
});

/**
 * 被指派角色（只算新增的角色，移除不算）：指派的角色有一個在公告的受眾裡時發送——例：成為主管時的說明。
 * 經由群組持有的角色不算（那是群組的成員異動）。
 */
export const USER_ROLE_ASSIGNED_TRIGGER = defineAnnouncementTrigger('user.roleAssigned', {
  scope: 'role',
});

export const USER_ANNOUNCEMENT_TRIGGERS: readonly AnnouncementTriggerDefinition[] = [
  USER_ACTIVATED_TRIGGER,
  USER_ROLE_ASSIGNED_TRIGGER,
];
