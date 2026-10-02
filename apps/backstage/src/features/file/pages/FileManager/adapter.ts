import type { IconName } from '@/components/Icon';
import { FILE_KIND_ICON, getFileKind, isBrowserImage } from '@/core/file';
import type { FileKind } from '@/core/file';
import type { FileFolder, StoredFile, TagSummary } from '@/shared/api-sdk';
import { formatBytes } from '@/shared/utils';

import { INLINE_PREVIEW_MAX_SIZE } from '../../constants';

/** 主區塊與 LightBox 使用的檔案 View Model。 */
export interface FileItemVM {
  type: 'file';
  id: string;
  name: string;
  contentType: string;
  kind: FileKind;
  icon: IconName;
  size: number;
  sizeLabel: string;
  /** 卡片與列表的預覽圖：縮圖優先；沒有縮圖的小圖直接用原檔；其他為 null（顯示類型圖示）。 */
  previewUrl: string | null;
  /** LightBox 顯示用：伺服器產生的全螢幕預覽；沒有時為 null（改用 `url`）。 */
  displayUrl: string | null;
  url: string | null;
  downloadUrl: string | null;
  version: number;
  uploaderName: string | null;
  /** 改名、移動（後端的 `capabilities`）。 */
  canUpdate: boolean;
  canDelete: boolean;
  /** 貼著的標籤（`file` 標籤組，docs/adr/0032-tags.md）。 */
  tags: TagSummary[];
  createdAt: string;
  updatedAt: string;
}

export function toFileItemVM(file: StoredFile): FileItemVM {
  const kind = getFileKind(file.contentType, file.name);
  const inlinePreview =
    file.url && isBrowserImage(file.contentType) && file.size <= INLINE_PREVIEW_MAX_SIZE
      ? file.url
      : null;
  return {
    type: 'file',
    id: file.id,
    name: file.name,
    contentType: file.contentType,
    kind,
    icon: FILE_KIND_ICON[kind],
    size: file.size,
    sizeLabel: formatBytes(file.size),
    previewUrl: file.thumbnailUrl ?? inlinePreview,
    displayUrl: file.image?.previewUrl ?? null,
    url: file.url,
    downloadUrl: file.downloadUrl,
    version: file.version,
    uploaderName: file.uploader?.displayName ?? null,
    canUpdate: file.capabilities.canUpdate,
    canDelete: file.capabilities.canDelete,
    tags: file.tags,
    createdAt: file.createdAt,
    updatedAt: file.updatedAt,
  };
}

/** 主區塊裡的資料夾（排在檔案前面）。 */
export interface FolderItemVM {
  type: 'folder';
  id: string;
  name: string;
  parentId: string | null;
  /** 系統資料夾的種類（共用、私人、個人）；一般資料夾是 `normal`。 */
  kind: FileFolder['kind'];
  /** 直接包含的子資料夾數（檔案數要另外查，不顯示）。 */
  folderCount: number;
  /** 後端的 `capabilities`：false = 鎖住（看得到資料夾、看不到檔案）；在裡面上傳／建立、改名與移動它、刪除它、管理它的授權。 */
  canRead: boolean;
  canCreate: boolean;
  canUpdate: boolean;
  canDelete: boolean;
  canShare: boolean;
  /** 自己對這個資料夾有一筆待審的存取申請。 */
  hasPendingAccessRequest: boolean;
  /** 貼著的標籤（與檔案共用 `file` 標籤組）。 */
  tags: TagSummary[];
  updatedAt: string;
}

/** 主區塊的一格：資料夾或檔案。選取、框選、拖曳以 id 處理，不分種類。 */
export type BrowserItemVM = FolderItemVM | FileItemVM;

export function toFolderItemVM(folder: FileFolder, folderCount: number): FolderItemVM {
  return {
    type: 'folder',
    id: folder.id,
    name: folder.name,
    parentId: folder.parentId,
    kind: folder.kind,
    folderCount,
    ...folder.capabilities,
    hasPendingAccessRequest: folder.hasPendingAccessRequest,
    tags: folder.tags,
    updatedAt: folder.updatedAt,
  };
}

export function isFileItem(item: BrowserItemVM): item is FileItemVM {
  return item.type === 'file';
}

export function isFolderItem(item: BrowserItemVM): item is FolderItemVM {
  return item.type === 'folder';
}

/** 無限捲動的多頁合併：重新驗證途中頁與頁之間可能短暫重疊，以 id 去重（保留先出現的）。 */
export function mergePages(pages: ReadonlyArray<{ items: readonly StoredFile[] }>): StoredFile[] {
  const seen = new Set<string>();
  const merged: StoredFile[] = [];
  for (const page of pages) {
    for (const item of page.items) {
      if (seen.has(item.id)) continue;
      seen.add(item.id);
      merged.push(item);
    }
  }
  return merged;
}

/** 列表裡網址最早失效的時間（毫秒）；沒有網址時 `undefined`。 */
export function earliestUrlExpiry(files: readonly StoredFile[]): number | undefined {
  let earliest: number | undefined;
  for (const file of files) {
    if (!file.urlExpiresAt) continue;
    const time = Date.parse(file.urlExpiresAt);
    if (!Number.isNaN(time) && (earliest === undefined || time < earliest)) earliest = time;
  }
  return earliest;
}
