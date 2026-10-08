import { createRegistry } from '@b2b-system/web-shared/registry';
import type { ComponentType } from 'react';

/** 面板收到的資源：後端的 `resource_type`（api 的 `RESOURCE_TYPE`，例：`user`）與 id。 */
export interface ResourcePanelProps {
  resourceType: string;
  resourceId: string;
}

/**
 * 掛在資源頁面上的通用面板（docs/architecture/frontend/22-comment.md §2）：例如留言與關注。提供面板的 feature 在 plugin 的
 * **同步** 階段登記，擁有資源的頁面以 `<ResourcePanels>` 放一個位置——兩邊都不 import 對方，拿掉任何一邊另一邊照常運作。
 */
export interface ResourcePanelRegistration {
  /** 唯一的名稱，例：`comment`。 */
  id: string;
  /** 同一個頁面上的順序（小的在前）。 */
  order: number;
  /** 適用的資源類型；後端沒有登記的類型不要列（端點會回 404）。 */
  resourceTypes: readonly string[];
  /**
   * 以 `lazy()` 登記：只有資源頁會渲染它，登記本體會把面板用到的程式帶進首屏
   * （與偏好頁的分頁同一個做法，docs/architecture/frontend/02-plugin-system.md §4.3）。
   */
  Panel: ComponentType<ResourcePanelProps>;
  /** 面板用到的語系 scope：資源頁不一定載入了它，`<ResourcePanels>` 掛上時載入。 */
  localeScope?: string;
}

/** 可訂閱：feature 在執行期安裝或卸載時，頁面上的面板跟著出現或消失（docs/architecture/frontend/02-plugin-system.md §9.2 D4）。 */
export const resourcePanelRegistry = createRegistry<string, ResourcePanelRegistration>(
  'Resource panel',
);

/** 回傳反註冊函式；在 plugin 的 factory 裡呼叫時由容器收集。重複登記同一個 `id` 丟例外。 */
export function registerResourcePanel(registration: ResourcePanelRegistration): () => void {
  return resourcePanelRegistry.register(registration.id, registration);
}

/** 測試用。 */
export function resetResourcePanelRegistry(): void {
  resourcePanelRegistry.reset();
}
