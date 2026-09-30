import { useMemo, useState } from 'react';

import { Icon } from '@/components/Icon';
import { useTranslation } from '@/core/locales';
import { cn } from '@/shared/utils';

import { FILE_FOLDER_KIND_ICON } from '../../../constants';
import { childFolders, folderPath } from '../folderTree';
import type { FolderIndex } from '../folderTree';
import type { ItemDrag } from '../useItemDrag';

interface FileFolderTreeProps {
  folders: FolderIndex;
  /** 標示為目前選取的資料夾；根目錄是 undefined。 */
  selectedId: string | undefined;
  onSelect: (folderId: string | undefined) => void;
  /** 不能選的資料夾（移動對話框：要移動的資料夾本身與它們的子孫）。 */
  isDisabled?: (folderId: string | undefined) => boolean;
  /** 側欄：節點可拖曳（移動資料夾）、也是放置目標。移動對話框不帶。 */
  itemDrag?: ItemDrag;
  canMove?: boolean;
  className?: string;
  'data-testid'?: string;
}

/**
 * 資料夾樹（docs/architecture/frontend/12-file-manager.md §12）：側欄與移動對話框共用。
 * 目前資料夾的所有上層自動展開（之後選到別處也保持展開）；其餘由使用者展開、收合。
 * 每個節點是一般的按鈕（Tab 可到、Enter 可選），不做 WAI-ARIA tree 的方向鍵導覽。
 */
export function FileFolderTree({
  folders,
  selectedId,
  onSelect,
  isDisabled,
  itemDrag,
  canMove = false,
  className,
  'data-testid': testId,
}: FileFolderTreeProps) {
  const { t } = useTranslation();
  const [toggled, setToggled] = useState<ReadonlyMap<string, boolean>>(() => new Map());
  const ancestors = useMemo(
    () => new Set(folderPath(folders, selectedId).map((folder) => folder.id)),
    [folders, selectedId],
  );
  // 曾經因為選取而自動展開的節點保持展開：選到別的資料夾時原本展開的分支不會突然收起來
  const [autoExpanded, setAutoExpanded] = useState<ReadonlySet<string>>(() => new Set());
  if ([...ancestors].some((id) => !autoExpanded.has(id))) {
    setAutoExpanded(new Set([...autoExpanded, ...ancestors]));
  }
  const isExpanded = (id: string) => toggled.get(id) ?? (autoExpanded.has(id) || ancestors.has(id));
  const toggle = (id: string) => setToggled((current) => new Map(current).set(id, !isExpanded(id)));

  const renderNode = (id: string | undefined, name: string, depth: number) => {
    const children = childFolders(folders, id);
    const expanded = id === undefined || isExpanded(id);
    const disabled = isDisabled?.(id) ?? false;
    const dropOver = itemDrag?.isOver(id) ?? false;
    const folder = id ? folders.byId.get(id) : undefined;
    const locked = folder?.capabilities.canRead === false;
    return (
      <li key={id ?? 'root'} className="m-0 list-none p-0">
        <div
          className={cn(
            'flex items-center rounded',
            selectedId === id && 'bg-[var(--color-fill)]',
            dropOver &&
              'bg-[color-mix(in_srgb,var(--color-brand)_14%,transparent)] outline-2 -outline-offset-2 outline-[var(--color-brand)]',
          )}
          style={{ paddingLeft: depth * 12 }}
        >
          {id !== undefined && children.length > 0 ? (
            <button
              type="button"
              aria-label={expanded ? t('file.folder.collapse') : t('file.folder.expand')}
              aria-expanded={expanded}
              onClick={() => toggle(id)}
              className="flex size-6 shrink-0 cursor-pointer items-center justify-center rounded border-0 bg-transparent p-0 text-[var(--color-fg-muted)] hover:bg-[var(--color-fill-subtle)]"
              data-testid="file-folder-tree-toggle"
              data-value={id}
            >
              <Icon name={expanded ? 'chevron-down' : 'chevron-right'} size={14} />
            </button>
          ) : (
            <span className="size-6 shrink-0" />
          )}
          <button
            type="button"
            disabled={disabled}
            aria-current={selectedId === id ? 'true' : undefined}
            onClick={() => onSelect(id)}
            draggable={Boolean(itemDrag && canMove && folder?.capabilities.canUpdate)}
            onDragStart={(event) => {
              if (!itemDrag || !folder) return;
              itemDrag.startDrag(
                event,
                {
                  fileIds: [],
                  folderIds: [folder.id],
                  sourceFolderId: folder.parentId ?? undefined,
                },
                folder.name,
              );
            }}
            onDragEnd={itemDrag?.endDrag}
            data-drop-folder={itemDrag ? (id ?? '') : undefined}
            data-testid="file-folder-tree-item"
            data-value={id ?? 'root'}
            className={cn(
              'flex min-w-0 flex-1 cursor-pointer items-center gap-1.5 rounded border-0 bg-transparent py-1 pr-2 pl-0.5 text-left text-sm text-[var(--color-fg)] hover:bg-[var(--color-fill-subtle)] disabled:cursor-not-allowed disabled:opacity-40',
              selectedId === id && 'font-semibold',
            )}
          >
            <Icon
              name={
                id === undefined
                  ? 'home'
                  : locked
                    ? 'lock'
                    : FILE_FOLDER_KIND_ICON[folder?.kind ?? 'normal']
              }
              size={16}
              className={cn(
                'shrink-0',
                locked ? 'text-[var(--color-fg-muted)]' : 'text-[var(--color-brand)]',
              )}
              aria-label={locked ? t('file.access.locked') : undefined}
            />
            <span className={cn('truncate', locked && 'text-[var(--color-fg-muted)]')}>{name}</span>
          </button>
        </div>
        {expanded && children.length > 0 && (
          <ul className="m-0 p-0">
            {children.map((child) => renderNode(child.id, child.name, depth + 1))}
          </ul>
        )}
      </li>
    );
  };

  return (
    <ul
      className={cn('m-0 flex flex-col p-0', className)}
      aria-label={t('file.folder.tree')}
      data-testid={testId}
      {...itemDrag?.dropHandlers}
    >
      {renderNode(undefined, t('file.folder.root'), 0)}
    </ul>
  );
}

/** 桌面寬度的側欄（`lg` 以上）：窄螢幕改用麵包屑往上層，把寬度讓給主區塊。 */
export function FileFolderSidebar(props: Omit<FileFolderTreeProps, 'className' | 'data-testid'>) {
  const { t } = useTranslation();
  return (
    <aside
      className="hidden w-56 shrink-0 overflow-auto rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-1 lg:block"
      aria-label={t('file.folder.tree')}
    >
      <FileFolderTree {...props} data-testid="file-folder-tree" />
    </aside>
  );
}
