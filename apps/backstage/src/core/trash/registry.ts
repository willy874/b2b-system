import { i18n, loadLocaleScope } from '@b2b-system/web-core/locales';
import { createRegistry } from '@b2b-system/web-shared/registry';
import type { ComponentType } from 'react';

import type { PermissionKey } from '@/core/permission';
import type { TrashItem, TrashResourceType } from '@/shared/api-sdk';

/** 還原按鈕收到的一列；元件自己決定怎麼呼叫還原 API、怎麼呈現錯誤。 */
export interface TrashRestoreActionProps {
  item: TrashItem;
}

/**
 * 回收桶的一種資源類型（docs/architecture/frontend/13-trash.md）。擁有資源的 feature 在 plugin 的 **同步** 階段登記，
 * 回收桶頁（`features/trash`）只讀這個註冊表，不 import 任何業務 feature——與後端的 `TrashRegistry` 對稱。
 */
export interface TrashTypeRegistration {
  /** 後端 `GET /trash?type=` 的值；也是分頁（tab）與網址的鍵，發佈後不改名。 */
  type: TrashResourceType;
  /** 分頁的順序（小的在前）。 */
  order: number;
  /** 分頁標題；放在全域語系包（回收桶頁不一定載入了擁有者的 scope）。 */
  labelI18nKey: string;
  /** 看這一類與還原所需的權限（`<resource>:delete`，docs/architecture/backend/14-revisions.md §9.2 D10）；沒有的人看不到這個分頁。 */
  permission: PermissionKey;
  /** 還原操作用到的語系 scope；回收桶頁的 route loader 一併載入。 */
  localeScope?: string;
  /** 每一列的還原操作：還原端點由擁有者提供（`POST /<resource>/:id/restore`），錯誤的呈現也由它決定。 */
  RestoreAction: ComponentType<TrashRestoreActionProps>;
}

/** 可訂閱：feature 在執行期安裝或卸載時，回收桶頁跟著更新（docs/architecture/frontend/02-plugin-system.md §9.2 D4）。 */
export const trashTypeRegistry = createRegistry<TrashResourceType, TrashTypeRegistration>(
  'Trash type',
);

/** 回傳反註冊函式；在 plugin 的 factory 裡呼叫時由容器收集。重複登記同一個 `type` 丟例外。 */
export function registerTrashType(registration: TrashTypeRegistration): () => void {
  return trashTypeRegistry.register(registration.type, registration);
}

export function sortTrashTypes(
  registrations: Iterable<TrashTypeRegistration>,
): TrashTypeRegistration[] {
  return [...registrations].toSorted((a, b) => a.order - b.order);
}

export function getTrashTypes(): TrashTypeRegistration[] {
  return sortTrashTypes(trashTypeRegistry.values());
}

/** 回收桶頁的 route loader：頁面自己的 scope 加上各類型還原操作的 scope。 */
export function trashLocaleLoader(...scopes: string[]) {
  return async (): Promise<void> => {
    const all = new Set([...scopes, ...getTrashTypes().flatMap((type) => type.localeScope ?? [])]);
    await Promise.all([...all].map((scope) => loadLocaleScope(scope, i18n.language)));
  };
}

/** 測試用。 */
export function resetTrashRegistry(): void {
  trashTypeRegistry.reset();
}
