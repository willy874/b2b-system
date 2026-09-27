import type { FileFolder } from '@/shared/api-sdk';

/** 根目錄在樹裡的 key（`parentId` 為 null 的資料夾掛在它底下）。 */
export const ROOT_FOLDER = 'root';

/**
 * 由扁平的資料夾清單（`GET /file-folders`）組出的索引：
 * 麵包屑、樹狀面板、移動對話框、拖放的合法性判斷共用同一份（docs/architecture/frontend/12-file-manager.md §12）。
 */
export interface FolderIndex {
  byId: ReadonlyMap<string, FileFolder>;
  /** 上層 id（根目錄為 `ROOT_FOLDER`）→ 子資料夾（依名稱排序）。 */
  children: ReadonlyMap<string, readonly FileFolder[]>;
}

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

/** 名稱的自然排序（`img2` 排在 `img10` 前面、不分大小寫）。 */
export function compareFolderName(a: { name: string }, b: { name: string }): number {
  return collator.compare(a.name, b.name);
}

export function buildFolderIndex(folders: readonly FileFolder[]): FolderIndex {
  const byId = new Map(folders.map((folder) => [folder.id, folder]));
  const children = new Map<string, FileFolder[]>();
  for (const folder of folders) {
    // 上層不在清單裡（剛被刪除、推播還沒到）：當成孤兒不顯示，而不是誤掛到根目錄
    if (folder.parentId && !byId.has(folder.parentId)) continue;
    const key = folder.parentId ?? ROOT_FOLDER;
    const list = children.get(key) ?? [];
    list.push(folder);
    children.set(key, list);
  }
  for (const list of children.values()) list.sort(compareFolderName);
  return { byId, children };
}

export function childFolders(
  index: FolderIndex,
  folderId: string | undefined,
): readonly FileFolder[] {
  return index.children.get(folderId ?? ROOT_FOLDER) ?? [];
}

/** 從根目錄到 `folderId` 的資料夾（不含根目錄）；不存在時為空陣列。 */
export function folderPath(index: FolderIndex, folderId: string | undefined): FileFolder[] {
  const path: FileFolder[] = [];
  const seen = new Set<string>();
  let current = folderId ? index.byId.get(folderId) : undefined;
  while (current && !seen.has(current.id)) {
    seen.add(current.id);
    path.unshift(current);
    current = current.parentId ? index.byId.get(current.parentId) : undefined;
  }
  return path;
}

/** `folderId` 是 `ancestorId` 本身或它的子孫。 */
export function isWithin(index: FolderIndex, folderId: string, ancestorId: string): boolean {
  return folderPath(index, folderId).some((folder) => folder.id === ancestorId);
}

/**
 * 能不能把這些資料夾移到 `targetId`（undefined 是根目錄）：目的地不可以是其中任何一個或它們的子孫。
 * 與後端的 `FILE_FOLDER_CYCLE` 同一條規則，拖曳時先擋下，不必送出去才失敗。
 */
export function canMoveFoldersTo(
  index: FolderIndex,
  folderIds: readonly string[],
  targetId: string | undefined,
): boolean {
  if (!targetId) return true;
  return !folderIds.some((id) => isWithin(index, targetId, id));
}
