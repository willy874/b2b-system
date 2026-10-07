import type { IconName } from '@b2b-system/ui/Icon';
import { createRegistry } from '@b2b-system/web-shared/registry';

import type { PageKey } from '../permission';
import type { RouteLinkRef } from '../route-link';

/** 一筆資料搜尋的結果。只放顯示用的文字與連結，不放整份 DTO。 */
export interface SearchResult {
  /** 在同一個提供者裡唯一（通常是資源 id）。 */
  id: string;
  label: string;
  /** 第二行的補充（email、資料夾路徑…）。 */
  description?: string;
  /**
   * 以 route id 指向目標頁（docs/architecture/frontend/03-feature-anatomy.md §4.1）：面板不 import feature 的 route，
   * 連結解析不出來（feature 沒安裝）或檢視者進不了目標頁時，這一筆不顯示。
   */
  link: RouteLinkRef;
}

/**
 * 資料搜尋的提供者：feature 用自己的 `apis/` 實作（通常是列表 API 加 `keyword` 與小 `limit`），
 * 權限過濾由後端負責；`pageKey` 讓進不了列表頁的人連請求都不發。
 */
export interface SearchProvider {
  /** 發佈後不改名：查詢快取的鍵。 */
  key: string;
  /** 結果分組的標題；放全域語系包（側欄的 `menu.*` 可以直接用），面板在任何頁面都會打開。 */
  labelI18nKey: string;
  icon: IconName;
  /** 檢視者進不了這一頁時不搜尋。 */
  pageKey?: PageKey;
  /** 分組的先後，數字小的在上。 */
  order: number;
  /** `signal` 在使用者繼續打字或關閉面板時中止；回傳的筆數由提供者自己限制（建議 5 筆）。 */
  search: (query: string, signal: AbortSignal) => Promise<SearchResult[]>;
}

interface CommandBase {
  /** 發佈後不改名。 */
  key: string;
  labelI18nKey: string;
  icon: IconName;
  /** 檢視者進不了這一頁時不列出（例：「建立使用者」用 `USER_CREATE` 頁）。 */
  pageKey?: PageKey;
  /** 數字小的在上。 */
  order: number;
}

/** 前往某一頁（最常見：建立對話框的路徑）。 */
export interface NavigateCommand extends CommandBase {
  to: string;
}

/** 在目前的頁面執行（切換主題）。面板先關閉再執行。 */
export interface RunCommand extends CommandBase {
  run: () => void;
}

export type PaletteCommand = NavigateCommand | RunCommand;

/** 可訂閱：可啟用的 feature 安裝或卸載時，面板跟著更新（docs/architecture/frontend/02-plugin-system.md §9.2 D4）。 */
export const searchProviderRegistry = createRegistry<string, SearchProvider>('Search provider');
export const paletteCommandRegistry = createRegistry<string, PaletteCommand>('Palette command');

/** feature 在 plugin 的同步階段登記。回傳反註冊函式。 */
export function registerSearchProvider(provider: SearchProvider): () => void {
  return searchProviderRegistry.register(provider.key, provider);
}

/** feature 或 app 在 plugin 的同步階段登記。回傳反註冊函式。 */
export function registerPaletteCommand(command: PaletteCommand): () => void {
  return paletteCommandRegistry.register(command.key, command);
}

/** 測試用。 */
export function resetCommandPaletteRegistry(): void {
  searchProviderRegistry.reset();
  paletteCommandRegistry.reset();
}
