/** 跨 feature 的事件名稱。feature 內的事件放 `features/<name>/enums/events.ts`。 */
export const GlobalEvents = {
  SESSION_ENDED: 'session:ended',
  PERMISSIONS_CHANGED: 'permissions:changed',
  USER_ROLES_CHANGED: 'user:rolesChanged',
} as const;
