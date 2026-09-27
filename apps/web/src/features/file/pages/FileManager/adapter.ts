import type { IconName } from '@/components/Icon';
import { FILE_KIND_ICON, getFileKind, isBrowserImage } from '@/core/file';
import type { FileKind } from '@/core/file';
import type { StoredFile } from '@/shared/api-sdk';
import { formatBytes } from '@/shared/utils';

import { INLINE_PREVIEW_MAX_SIZE } from '../../constants';

/** 主區塊與 LightBox 使用的檔案 View Model。 */
export interface FileItemVM {
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
    createdAt: file.createdAt,
    updatedAt: file.updatedAt,
  };
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
