import { usePagePermission } from '@/core/permission';

import { FILE_PAGE } from '../permission';

/** 目前位置（資料夾或根目錄）的能力：資料夾是它的 `capabilities`，根目錄是 `rootCapabilities`。 */
export interface FileLocationCapabilities {
  canCreate: boolean;
  /** 根目錄沒有授權可管理。 */
  canShare?: boolean;
}

/** 項目（檔案或資料夾）的能力；由後端回傳，經 adapter 放進 VM。 */
export interface FileItemCapabilities {
  type: 'file' | 'folder';
  canUpdate: boolean;
  canDelete: boolean;
  /** 只有資料夾有。 */
  canShare?: boolean;
  /** 只有資料夾有；false = 鎖住。 */
  canRead?: boolean;
  /** 只有資料夾有：自己已有待審的存取申請。 */
  hasPendingAccessRequest?: boolean;
}

/**
 * 檔案管理器的權限 facade（docs/architecture/frontend/12-file-manager.md §13）。
 * 進入頁面看 `file:access` 或 `file:read`；按鈕不看全域權限鍵，而是後端依資料夾授權回傳的 `capabilities`
 * ——繼承與擁有者規則只在後端有一份。
 * 權限還沒水合、或資料夾清單還沒載入（`location` 為 undefined）時一律為 false：按鈕不會先出現再消失。
 */
export function useFilePermission(location: FileLocationCapabilities | undefined) {
  const page = usePagePermission(FILE_PAGE);
  const ready = page.hydrated && page.canAccess && location !== undefined;
  return {
    hydrated: page.hydrated,
    canAccess: page.canAccess,
    canUpload: ready && location.canCreate,
    canCreateFolder: ready && location.canCreate,
    canShare: ready && location.canShare === true,
  };
}

/** 選取的項目能做什麼：每一項都要能做才算（批次操作不做一半）。 */
export function selectionCapabilities(items: readonly FileItemCapabilities[]) {
  const [only] = items;
  const some = items.length > 0;
  return {
    canRename: items.length === 1 && only?.canUpdate === true,
    canMove: some && items.every((item) => item.canUpdate),
    canDelete: some && items.every((item) => item.canDelete),
    /** 只選一個資料夾、而且能管理它的授權。 */
    canShare: items.length === 1 && only?.type === 'folder' && only.canShare === true,
    /** 只選一個鎖住的資料夾：可以申請存取（docs/rbac/07-resource-grants.md §6.5）。 */
    canRequestAccess:
      items.length === 1 &&
      only?.type === 'folder' &&
      only.canRead === false &&
      only.hasPendingAccessRequest !== true,
  };
}
