import type { ComponentType } from 'react';

import { i18n, loadLocaleScope } from '@/core/locales';
import { createRegistry } from '@/shared/registry';

export interface PreferenceSection {
  key: string;
  order: number;
  labelI18nKey: string;
  Component: ComponentType;
  /** 分頁自己的語系包所在的 scope；偏好頁載入時一併下載（`preferenceLocaleLoader`）。 */
  localeScope?: string;
}

/**
 * 一張可以自訂欄位的列表：讓偏好頁在「不掛載該列表」的情況下也能列出、調整它的欄位設定。
 * `id` 與 `RichTable` 的 `settings.tableId` 是同一個值。
 */
export interface PreferenceTable {
  id: string;
  labelI18nKey: string;
  /** 可設定的欄位 id → 欄位名稱的語系 key；物件的鍵順序就是預設順序。 */
  columnLabelKeys: Record<string, string>;
  /** 沒有存過設定時預設隱藏的欄位。 */
  defaultHidden?: readonly string[];
  /** 列表沒有勾選欄（`enableRowSelection={false}`）時設為 `false`；預設有。 */
  selectable?: boolean;
  /** 列表沒有釘選欄（`enableRowPinning={false}`）時設為 `false`；預設有。 */
  rowPinning?: boolean;
  /** 名稱所在的語系 scope（通常是 feature 的 scope）；偏好頁會先載入它。 */
  localeScope?: string;
}

/** 可訂閱：feature 在執行期安裝或卸載時，偏好頁跟著更新（docs/adr/0021-runtime-feature-activation.md D4）。 */
export const preferenceSectionRegistry = createRegistry<string, PreferenceSection>(
  'Preference section',
);
export const preferenceTableRegistry = createRegistry<string, PreferenceTable>('Preference table');

/** 讓 feature 或 `plugins/features/*` 往偏好頁插分頁，偏好頁不需要認識它們。回傳反註冊函式。 */
export function registerPreferenceSection(section: PreferenceSection): () => void {
  return preferenceSectionRegistry.register(section.key, section);
}

export function sortPreferenceSections(sections: Iterable<PreferenceSection>): PreferenceSection[] {
  return [...sections].toSorted((a, b) => a.order - b.order);
}

export function getPreferenceSections(): PreferenceSection[] {
  return sortPreferenceSections(preferenceSectionRegistry.values());
}

/** feature 在 plugin 的同步階段登記自己的列表（docs/architecture/frontend/02-plugin-system.md §5）。回傳反註冊函式。 */
export function registerPreferenceTable(table: PreferenceTable): () => void {
  return preferenceTableRegistry.register(table.id, table);
}

export function getPreferenceTables(): PreferenceTable[] {
  return preferenceTableRegistry.values();
}

export function getPreferenceTable(id: string): PreferenceTable | undefined {
  return preferenceTableRegistry.get(id);
}

/**
 * 偏好頁的 route loader：除了頁面自己的 scope，也下載各分頁與各列表名稱所在的 scope，
 * 否則在那些 feature 的路由之外渲染時只會看到語系 key。
 */
export function preferenceLocaleLoader(...scopes: string[]) {
  return async (): Promise<void> => {
    const all = new Set([
      ...scopes,
      ...getPreferenceSections().flatMap((section) => section.localeScope ?? []),
      ...getPreferenceTables().flatMap((table) => table.localeScope ?? []),
    ]);
    await Promise.all([...all].map((scope) => loadLocaleScope(scope, i18n.language)));
  };
}

/** 測試用。 */
export function resetPreferenceRegistry(): void {
  preferenceSectionRegistry.reset();
  preferenceTableRegistry.reset();
}
