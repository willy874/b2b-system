import { Icon } from '@b2b-system/ui/Icon';
import { useTranslation } from '@b2b-system/web-core/locales';
import { cn } from '@b2b-system/web-shared/utils';
import { Fragment } from 'react';

import type { FileFolder } from '@/shared/api-sdk';

import type { ItemDrag } from '../useItemDrag';

interface FileBreadcrumbProps {
  /** 從根目錄到目前資料夾（不含根目錄）。 */
  path: readonly FileFolder[];
  onNavigate: (folderId: string | undefined) => void;
  /** 每一層都是放置目標：把項目拖到上層的麵包屑就能往上移。 */
  itemDrag: ItemDrag;
}

/**
 * 目前位置（docs/architecture/frontend/12-file-manager.md §12）。每一層可點擊回到該層，也可以把項目拖上去移動；
 * 窄螢幕沒有樹狀面板時，它是唯一的往上層入口。
 */
export function FileBreadcrumb({ path, onNavigate, itemDrag }: FileBreadcrumbProps) {
  const { t } = useTranslation();
  const levels = [
    { id: undefined, name: t('file.folder.root') },
    ...path.map((folder) => ({ id: folder.id as string | undefined, name: folder.name })),
  ];
  return (
    <nav aria-label={t('file.folder.location')} data-testid="file-breadcrumb">
      <ol
        className="m-0 flex min-w-0 flex-wrap items-center gap-0.5 p-0 text-sm"
        {...itemDrag.dropHandlers}
      >
        {levels.map((level, index) => {
          const isCurrent = index === levels.length - 1;
          return (
            <Fragment key={level.id ?? 'root'}>
              {index > 0 && (
                <li aria-hidden className="flex text-[var(--color-fg-muted)]">
                  <Icon name="chevron-right" size={14} />
                </li>
              )}
              <li className="flex min-w-0">
                <button
                  type="button"
                  aria-current={isCurrent ? 'location' : undefined}
                  onClick={() => onNavigate(level.id)}
                  data-drop-folder={level.id ?? ''}
                  data-drop-over={itemDrag.isOver(level.id) || undefined}
                  data-testid="file-breadcrumb-item"
                  data-value={level.id ?? 'root'}
                  className={cn(
                    'flex max-w-48 min-w-0 cursor-pointer items-center gap-1 rounded border-0 bg-transparent px-1.5 py-0.5 text-inherit hover:bg-[var(--color-fill-subtle)]',
                    isCurrent
                      ? 'font-semibold text-[var(--color-fg)]'
                      : 'text-[var(--color-fg-muted)]',
                    itemDrag.isOver(level.id) &&
                      'bg-[color-mix(in_srgb,var(--color-brand)_14%,transparent)] outline-2 outline-[var(--color-brand)]',
                  )}
                >
                  {index === 0 && <Icon name="home" size={14} />}
                  <span className="truncate">{level.name}</span>
                </button>
              </li>
            </Fragment>
          );
        })}
      </ol>
    </nav>
  );
}
