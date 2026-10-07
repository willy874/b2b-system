import { registerNavGroup } from '@b2b-system/web-core/navigation';

/**
 * 側欄的分類（docs/architecture/frontend/04-routing.md §9）：租戶（客戶與它們用得到的功能）、平台管理者、維運（稽核與背景工作）。
 * feature 的 `navigation.ts` 以這裡的 key 指定自己放在哪一類，分類本身由 app 在 `app/plugin.ts` 登記。
 */
export const NavGroupKey = {
  TENANT: 'tenant',
  PEOPLE: 'people',
  SYSTEM: 'system',
} as const;
export type NavGroupKey = (typeof NavGroupKey)[keyof typeof NavGroupKey];

/** 在 plugin 的同步階段呼叫一次（`app/plugin.ts`）。 */
export function registerNavGroups(): void {
  registerNavGroup({
    key: NavGroupKey.TENANT,
    labelKey: 'menu.group.tenant',
    testId: 'menu-group-tenant',
    order: 100,
  });
  registerNavGroup({
    key: NavGroupKey.PEOPLE,
    labelKey: 'menu.group.people',
    testId: 'menu-group-people',
    order: 200,
  });
  registerNavGroup({
    key: NavGroupKey.SYSTEM,
    labelKey: 'menu.group.system',
    testId: 'menu-group-system',
    order: 300,
  });
}
