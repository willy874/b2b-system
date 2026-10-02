import type { TenantFeature } from '@/core/tenant';

/**
 * 事件點的比對方式（docs/adr/0031-announcements.md D13、D14）：事件的使用者要「在公告的受眾裡」才發送。
 * - `audience`：使用者屬於公告的受眾（全租戶、指定的人、群組含巢狀、角色）
 * - `group`：事件帶的群組是受眾裡的群組（或受眾是全租戶）——「加入財務群組的人」
 * - `role`：事件帶的角色有一個是受眾裡的角色（或受眾是全租戶）——「被指派主管角色的人」
 */
export type AnnouncementTriggerScope = 'audience' | 'group' | 'role';

/** 一個觸發點；由擁有者模組以 `defineAnnouncementTrigger()` 宣告、在 `*.module.ts` 登記。 */
export interface AnnouncementTriggerDefinition {
  readonly event: string;
  readonly scope: AnnouncementTriggerScope;
  /** 所屬的可啟用 feature：沒啟用時不列出、不觸發。 */
  readonly feature: TenantFeature | null;
}

/** 觸發時帶的資料：哪些使用者，以及比對用的群組或角色。 */
export interface AnnouncementTriggerFire {
  userIds: readonly string[];
  groupId?: string;
  roleIds?: readonly string[];
}

const EVENT_PATTERN = /^[a-z][A-Za-z0-9]*\.[a-z][A-Za-z0-9]*$/;

/**
 * 宣告一個觸發點。名稱是 `<模組>.<事件>`（camelCase，與通知類型同一種命名）；格式不對在模組載入時就失敗。
 * 已發布的名稱不改名：公告的 `trigger.event` 存的是它。
 */
export function defineAnnouncementTrigger(
  event: string,
  meta: { scope: AnnouncementTriggerScope; feature?: TenantFeature },
): AnnouncementTriggerDefinition {
  if (!EVENT_PATTERN.test(event)) {
    throw new Error(`公告的觸發點 ${event} 必須是 <模組>.<事件>（camelCase）`);
  }
  return { event, scope: meta.scope, feature: meta.feature ?? null };
}
