import type { IconName } from '@b2b-system/ui/Icon';
import { createRegistry } from '@b2b-system/web-shared/registry';

import type { PageKey } from '../permission';

/**
 * 側欄的分類。分類是 app 的版面決定（哪些頁面放一起、先後順序），由 app 在 `app/plugin.ts` 登記；
 * 頁面由擁有它的 feature 登記（`registerNavItem`），以 `group` 指向分類的 `key`。
 */
export interface NavGroup {
  /** feature 的 `registerNavItem({ group })` 以它指向這個分類；發佈後不改名。 */
  key: string;
  labelKey: string;
  /** 父選單（展開／收合按鈕）的 testid，完整字面量（docs/conventions/06-literal-strings.md §3.3）。 */
  testId: string;
  /** 數字小的在上；預留間隔，之後插在中間不必改既有的值。 */
  order: number;
}

/** `sidebar`：側欄（`group` 省略時列在最上方，例：首頁）；`account`：頂列的帳號選單（個人資料、偏好設定）。 */
export type NavPlacement = 'sidebar' | 'account';

/** 一個頁面的入口：側欄或帳號選單的一項，也是命令面板「頁面」與「最近造訪」的來源。 */
export interface NavItem {
  /** 一個頁面只有一個入口；同一個 page key 重複登記丟例外。 */
  pageKey: PageKey;
  /** 點下去的路徑（例：通知總覽是 `/notification/all`，不一定是頁面權限的 base path）。 */
  to: string;
  labelKey: string;
  icon: IconName;
  /** 完整字面量，E2E 以此定位選單項。 */
  testId: string;
  /** 同一個分類裡數字小的在上。 */
  order: number;
  /** 所屬分類的 `key`；省略時列在側欄最上方。`placement: 'account'` 時不可指定。 */
  group?: string;
  /** 預設 `sidebar`。 */
  placement?: NavPlacement;
}

/** 可訂閱：可啟用的 feature 安裝或卸載時，側欄與命令面板跟著更新（docs/architecture/frontend/02-plugin-system.md §9.2 D4）。 */
export const navGroupRegistry = createRegistry<string, NavGroup>('Nav group');
export const navItemRegistry = createRegistry<PageKey, NavItem>('Nav item');

/** app 在 plugin 的同步階段登記側欄的分類。回傳反註冊函式。 */
export function registerNavGroup(group: NavGroup): () => void {
  return navGroupRegistry.register(group.key, group);
}

/**
 * feature 在 plugin 的同步階段登記自己頁面的入口（與 `registerPagePermission` 同一處）。回傳反註冊函式；
 * 在 factory 裡呼叫時由容器收集，feature 卸載時入口一起消失。
 */
export function registerNavItem(item: NavItem): () => void {
  if (item.placement === 'account' && item.group !== undefined) {
    throw new Error(`Nav item ${item.pageKey} 放在帳號選單，不能指定分類 ${item.group}`);
  }
  return navItemRegistry.register(item.pageKey, item);
}

export interface ResolvedNavGroup extends Omit<NavGroup, 'order'> {
  items: NavItem[];
}

export interface ResolvedNavigation {
  /** 側欄最上方、不屬於任何分類的項目。 */
  topItems: NavItem[];
  /** 依 `order` 排好的分類；沒有任何項目的分類也列出（側欄會依權限再過濾一次）。 */
  groups: ResolvedNavGroup[];
  accountItems: NavItem[];
}

const byOrder = (a: { order: number }, b: { order: number }) => a.order - b.order;

/**
 * 把登記的分類與項目組成選單。項目指向沒有登記的分類是程式錯誤（分類 key 打錯、app 漏登記），直接丟例外，
 * 不讓頁面默默從選單消失（docs/architecture/frontend/02-plugin-system.md §6：讀取時 miss → 丟例外）。
 */
export function resolveNavigation(
  groups: Iterable<NavGroup>,
  items: Iterable<NavItem>,
): ResolvedNavigation {
  const sortedItems = [...items].toSorted(byOrder);
  const resolvedGroups = [...groups].toSorted(byOrder).map(({ key, labelKey, testId }) => ({
    key,
    labelKey,
    testId,
    items: [] as NavItem[],
  }));
  const groupByKey = new Map(resolvedGroups.map((group) => [group.key, group]));
  const topItems: NavItem[] = [];
  const accountItems: NavItem[] = [];

  for (const item of sortedItems) {
    if (item.placement === 'account') {
      accountItems.push(item);
      continue;
    }
    if (item.group === undefined) {
      topItems.push(item);
      continue;
    }
    const group = groupByKey.get(item.group);
    if (!group) {
      throw new Error(
        `Nav group not registered: ${item.group} (page ${item.pageKey}). 請在 app 的 app/plugin.ts 登記這個分類。`,
      );
    }
    group.items.push(item);
  }

  return { topItems, groups: resolvedGroups, accountItems };
}

/** 測試用。 */
export function resetNavigationRegistry(): void {
  navGroupRegistry.reset();
  navItemRegistry.reset();
}
