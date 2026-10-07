import { IconButton } from '@b2b-system/ui/Button';
import { Icon } from '@b2b-system/ui/Icon';
import { Menu } from '@b2b-system/ui/Menu';
import { useTranslation } from '@b2b-system/web-core/locales';
import { cn } from '@b2b-system/web-shared/utils';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';

import type { FileFolder } from '@/shared/api-sdk';

import { collapsedRange } from '../breadcrumbLayout';
import { useElementSize } from '../useElementSize';
import type { ItemDrag } from '../useItemDrag';

/** 拖曳中停在「…」上多久自動展開，才能放到被收起來的那幾層。 */
const DRAG_OPEN_DELAY_MS = 500;

/** 一層的外觀；量寬度用的隱藏副本與實際的按鈕共用，兩邊的寬度才會一致。 */
const LEVEL_CLASS =
  'flex max-w-48 min-w-0 items-center gap-1 rounded px-1.5 py-0.5 text-[var(--color-fg-muted)]';
const CURRENT_LEVEL_CLASS = 'font-semibold text-[var(--color-fg)]';

interface Level {
  id: string | undefined;
  name: string;
}

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
 *
 * 永遠只佔一列：放不下時中間的層收進「…」選單（`collapsedRange`），選單裡的每一層同樣能點、能放；
 * 拖曳中停在「…」上會自動展開。寬度由一份看不見的副本量出來，跟著容器寬度與資料夾名稱重算。
 */
export function FileBreadcrumb({ path, onNavigate, itemDrag }: FileBreadcrumbProps) {
  const { t } = useTranslation();
  const levels: Level[] = [
    { id: undefined, name: t('file.folder.root') },
    ...path.map((folder) => ({ id: folder.id as string | undefined, name: folder.name })),
  ];

  const [nav, setNav] = useState<HTMLElement | null>(null);
  const [measure, setMeasure] = useState<HTMLOListElement | null>(null);
  const available = useElementSize(nav).width;
  const [widths, setWidths] = useState<{ levels: number[]; ellipsis: number }>();
  // 副本以名稱為 key：換了資料夾就重建、重新量；字型載入完成等寬度變化由 ResizeObserver 接手
  const levelKey = levels.map((level) => level.name).join('\u0000');
  useLayoutEffect(() => {
    if (!measure || typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(() => {
      const children = Array.from(measure.children, (child) => (child as HTMLElement).offsetWidth);
      // 最後一個是「…」
      setWidths({ levels: children.slice(0, -1), ellipsis: children.at(-1) ?? 0 });
    });
    observer.observe(measure);
    return () => observer.disconnect();
  }, [measure]);
  const range =
    widths && widths.levels.length === levels.length && available > 0
      ? collapsedRange(widths.levels, widths.ellipsis, available)
      : undefined;

  const [menuOpen, setMenuOpen] = useState(false);
  const openedByDrag = useRef(false);
  const dragOpenTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const cancelDragOpen = () => clearTimeout(dragOpenTimer.current);
  useEffect(() => () => clearTimeout(dragOpenTimer.current), []);
  // 為了放置而自動展開的選單，拖曳結束（放下或取消）就收起來
  useEffect(() => {
    if (itemDrag.isDragging || !openedByDrag.current) return;
    openedByDrag.current = false;
    setMenuOpen(false);
  }, [itemDrag.isDragging]);

  const levelButton = (level: Level, isCurrent: boolean) => (
    <button
      type="button"
      title={level.name}
      aria-current={isCurrent ? 'location' : undefined}
      onClick={() => onNavigate(level.id)}
      data-drop-folder={level.id ?? ''}
      data-drop-over={itemDrag.isOver(level.id) || undefined}
      data-testid="file-breadcrumb-item"
      data-value={level.id ?? 'root'}
      className={cn(
        LEVEL_CLASS,
        'cursor-pointer border-0 bg-transparent text-inherit hover:bg-[var(--color-fill-subtle)]',
        isCurrent && CURRENT_LEVEL_CLASS,
        itemDrag.isOver(level.id) &&
          'bg-[color-mix(in_srgb,var(--color-brand)_14%,transparent)] outline-2 outline-[var(--color-brand)]',
      )}
    >
      {level.id === undefined && <Icon name="home" size={14} className="shrink-0" />}
      <span className="truncate">{level.name}</span>
    </button>
  );

  const separator = (
    <span aria-hidden className="flex shrink-0 text-[var(--color-fg-muted)]">
      <Icon name="chevron-right" size={14} />
    </span>
  );

  const hidden = range ? levels.slice(range.start, range.end) : [];
  const ellipsis = (
    <li key="collapsed" className="flex shrink-0 items-center gap-0.5">
      {separator}
      <Menu
        open={menuOpen}
        onOpenChange={(next) => {
          openedByDrag.current = false;
          setMenuOpen(next);
        }}
        trigger={
          <IconButton
            size="sm"
            aria-label={t('file.folder.collapsed')}
            onDragEnter={() => {
              if (!itemDrag.isDragging || menuOpen) return;
              cancelDragOpen();
              dragOpenTimer.current = setTimeout(() => {
                openedByDrag.current = true;
                setMenuOpen(true);
              }, DRAG_OPEN_DELAY_MS);
            }}
            onDragLeave={cancelDragOpen}
            data-testid="file-breadcrumb-collapsed"
          >
            <Icon name="more" size={16} />
          </IconButton>
        }
        items={hidden.map((level) => ({
          key: level.id ?? 'root',
          textValue: level.name,
          label: (
            <span
              className={cn(
                'flex min-w-0 items-center gap-2 rounded',
                itemDrag.isOver(level.id) &&
                  'outline-2 outline-offset-4 outline-[var(--color-brand)]',
              )}
            >
              <Icon name="folder" size={14} className="shrink-0" />
              <span className="truncate">{level.name}</span>
            </span>
          ),
          // 選單在 portal 裡，但 React 的事件仍沿元件樹冒泡到 <ol> 的拖放 handler；以 data-drop-folder 標出目標
          render: <div data-drop-folder={level.id ?? ''} />,
          onSelect: () => onNavigate(level.id),
        }))}
        data-testid="file-breadcrumb-collapsed-menu"
      />
    </li>
  );

  return (
    <nav
      ref={setNav}
      aria-label={t('file.folder.location')}
      className="relative min-w-0 flex-1"
      data-testid="file-breadcrumb"
    >
      <ol
        className="m-0 flex min-w-0 items-center overflow-hidden p-0 text-sm"
        {...itemDrag.dropHandlers}
      >
        {levels.map((level, index) => {
          if (range && index >= range.start && index < range.end) {
            return index === range.start ? ellipsis : null;
          }
          const isCurrent = index === levels.length - 1;
          return (
            <li
              key={level.id ?? 'root'}
              className={cn('flex items-center gap-0.5', isCurrent ? 'min-w-0' : 'shrink-0')}
            >
              {index > 0 && separator}
              {levelButton(level, isCurrent)}
            </li>
          );
        })}
      </ol>

      {/* 量寬度用：每一層完整顯示時的寬度，最後一個是「…」；看不見、不佔版面也不被報讀 */}
      <ol
        key={levelKey}
        ref={setMeasure}
        aria-hidden
        className="invisible absolute top-0 left-0 m-0 flex w-max p-0 text-sm"
      >
        {levels.map((level, index) => (
          <li key={level.id ?? 'root'} className="flex items-center gap-0.5">
            {index > 0 && separator}
            <span className={cn(LEVEL_CLASS, index === levels.length - 1 && CURRENT_LEVEL_CLASS)}>
              {level.id === undefined && <Icon name="home" size={14} className="shrink-0" />}
              <span className="truncate">{level.name}</span>
            </span>
          </li>
        ))}
        <li className="flex items-center gap-0.5">
          {separator}
          <IconButton size="sm" tabIndex={-1} aria-label="">
            <Icon name="more" size={16} />
          </IconButton>
        </li>
      </ol>
    </nav>
  );
}
