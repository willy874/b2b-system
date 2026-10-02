import { defineAnnouncementTrigger } from '@/modules/announcement/announcement.triggers';
import type { AnnouncementTriggerDefinition } from '@/modules/announcement/announcement.triggers';

/**
 * 使用者被加進群組（直接成員；docs/architecture/backend/19-announcement.md §9.2 D14）：加入的群組在公告的受眾裡時發送——
 * 例：加入財務群組的人收到財務流程說明。把一個群組加進另一個群組時，那個群組底下的人不算（只看直接加入的使用者）。
 */
export const GROUP_MEMBER_ADDED_TRIGGER = defineAnnouncementTrigger('group.memberAdded', {
  scope: 'group',
});

export const GROUP_ANNOUNCEMENT_TRIGGERS: readonly AnnouncementTriggerDefinition[] = [
  GROUP_MEMBER_ADDED_TRIGGER,
];
