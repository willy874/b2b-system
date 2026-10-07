import type { CSSProperties } from 'react';

import type { FileViewMode } from '../../../preference';
import type { BrowserItemVM } from '../adapter';
import type { FileListColumn } from '../layout';
import { FileGridItem } from './FileGridItem';
import { FileListRow } from './FileListRow';
import { FolderGridItem } from './FolderGridItem';
import { FolderListRow } from './FolderListRow';

interface FileBrowserItemProps {
  item: BrowserItemVM;
  viewMode: FileViewMode;
  /** 列表排版看得到的欄 */
  columns: readonly FileListColumn[];
  selected: boolean;
  focused: boolean;
  /** 已經有選取：卡片常駐勾選框 */
  selecting: boolean;
  /** 拖曳（電腦的檔案或頁面內的項目）停在這個資料夾上 */
  dropOver: boolean;
  draggable: boolean;
  /** 版面計算出的位置與尺寸 */
  style: CSSProperties;
  onStaleUrl: () => void;
  onToggle: (id: string) => void;
}

/** 瀏覽區的一格：資料夾或檔案、卡片或列。 */
export function FileBrowserItem({
  item,
  viewMode,
  columns,
  selected,
  focused,
  selecting,
  dropOver,
  draggable,
  style,
  onStaleUrl,
  onToggle,
}: FileBrowserItemProps) {
  if (item.type === 'folder') {
    return viewMode === 'grid' ? (
      <FolderGridItem
        item={item}
        selected={selected}
        focused={focused}
        selecting={selecting}
        dropOver={dropOver}
        draggable={draggable}
        style={style}
        onToggle={onToggle}
      />
    ) : (
      <FolderListRow
        item={item}
        columns={columns}
        selected={selected}
        focused={focused}
        dropOver={dropOver}
        draggable={draggable}
        style={style}
        onToggle={onToggle}
      />
    );
  }
  return viewMode === 'grid' ? (
    <FileGridItem
      item={item}
      selected={selected}
      focused={focused}
      selecting={selecting}
      draggable={draggable}
      style={style}
      onStaleUrl={onStaleUrl}
      onToggle={onToggle}
    />
  ) : (
    <FileListRow
      item={item}
      columns={columns}
      selected={selected}
      focused={focused}
      draggable={draggable}
      style={style}
      onStaleUrl={onStaleUrl}
      onToggle={onToggle}
    />
  );
}
