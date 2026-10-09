import type { PageKey } from '@b2b-system/web-core/permission';
import { createRegistry } from '@b2b-system/web-shared/registry';
import type { ComponentType } from 'react';

/**
 * 首頁的一個區塊（docs/architecture/frontend/02-plugin-system.md §4.7）：例如審批的「待我審核」。區塊屬於登記它的 feature，
 * 首頁（`features/home`）只負責依序排出來——feature 之間不互相 import，拿掉任何一個 feature，它的區塊就消失。
 */
export interface HomeSection {
  /** 註冊表的鍵；發佈後不改名。 */
  key: string;
  /** 看得到這個區塊的頁面鍵：沒有權限、或所屬 feature 未啟用（頁面鍵沒有登記）時不顯示。 */
  pageKey: PageKey;
  /** 數字小的在前；預留間隔。 */
  order: number;
  /**
   * 以 `lazy()` 登記：只有首頁會渲染它，登記本體會把區塊用到的程式帶進首屏。
   * 沒有東西要顯示時（例：沒有待審）回傳 null，首頁不留空白的卡片。
   */
  Section: ComponentType;
  /** 區塊用到的語系 scope：首頁不一定載入了它，`<HomeSections>` 掛上時載入。 */
  localeScope?: string;
}

/** 可訂閱：可啟用的 feature 安裝或卸載時，區塊跟著出現或消失。 */
export const homeSectionRegistry = createRegistry<string, HomeSection>('Home section');

/** feature 在 plugin 的同步階段登記自己的區塊。回傳反註冊函式。 */
export function registerHomeSection(section: HomeSection): () => void {
  return homeSectionRegistry.register(section.key, section);
}

/** 測試用。 */
export function resetHomeSections(): void {
  homeSectionRegistry.reset();
}
