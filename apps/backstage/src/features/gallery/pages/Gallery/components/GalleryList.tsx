import { Checkbox } from '@b2b-system/ui/Checkbox';
import { VirtualList } from '@b2b-system/ui/VirtualList';
import { SignedImage } from '@b2b-system/web-core/image';
import { useTranslation } from '@b2b-system/web-core/locales';
import { formatDateTime } from '@b2b-system/web-shared/date';
import { cn, formatBytes } from '@b2b-system/web-shared/utils';
import { memo, useRef } from 'react';
import type { MouseEvent, Ref } from 'react';

import { TagChips } from '@/core/components';
import type { GalleryItem } from '@/shared/api-sdk';

import { GalleryPlaceholder } from '../../../components/GalleryPlaceholder';
import { onGalleryImageExpired } from '../../../imageExpiry';
import { StaleItemTrigger } from './StaleItemTrigger';

/** 一列的高度（px）：縮圖 48 ＋ 上下留白。列高固定，虛擬捲動最穩。 */
const ROW_HEIGHT = 64;

/** 勾選、縮圖與標題、圖片日期、尺寸、大小、標籤；表頭與資料列共用，欄位才會對齊。 */
const GRID_TEMPLATE =
  'grid-cols-[2rem_minmax(0,1fr)_10rem] md:grid-cols-[2rem_minmax(0,1fr)_11rem_8rem_6rem_12rem]';

/** Shift 是連續選取：不讓瀏覽器順便選取兩次點擊之間的文字。 */
function preventShiftSelect(event: MouseEvent) {
  if (event.shiftKey) event.preventDefault();
}

interface GalleryListProps {
  ref?: Ref<HTMLDivElement>;
  items: readonly GalleryItem[];
  /** 依加入時間排序時顯示加入時間，其餘顯示圖片日期（`sortAt`）。 */
  timeField: 'sortAt' | 'createdAt';
  selected: ReadonlySet<string>;
  /** 有選取時點一下是切換選取，否則是打開檢視器。 */
  selecting: boolean;
  hasMore: boolean;
  loading: boolean;
  onOpen: (item: GalleryItem) => void;
  onToggle: (item: GalleryItem, event: Pick<MouseEvent, 'shiftKey'>) => void;
  onEndReached: () => void;
  /** 來自快照的項目（被 `maxPages` 丟掉的頁）：畫出來時通知 `onStaleVisible`。 */
  stale: ReadonlyMap<string, unknown>;
  staleRevision: unknown;
  onStaleVisible: (id: string) => void;
}

interface RowProps {
  item: GalleryItem;
  date: string;
  isSelected: boolean;
  selecting: boolean;
  onOpen: (item: GalleryItem) => void;
  onToggle: (item: GalleryItem, event: Pick<MouseEvent, 'shiftKey'>) => void;
}

const GalleryListRow = memo(function GalleryListRow({
  item,
  date,
  isSelected,
  selecting,
  onOpen,
  onToggle,
}: RowProps) {
  const { t } = useTranslation();
  const shiftKey = useRef(false);
  return (
    <div
      className={cn(
        'grid h-16 items-center gap-3 border-b border-[var(--color-border)] px-3 text-sm hover:bg-[var(--color-fill-subtle)]',
        GRID_TEMPLATE,
        isSelected && 'bg-[var(--color-fill-subtle)]',
      )}
      data-selected={isSelected || undefined}
      data-testid="gallery-list-row"
      data-value={item.id}
    >
      {/* Checkbox 的 onCheckedChange 拿不到滑鼠事件：Shift 連續選取要的 shiftKey 在外層的 click 先記下 */}
      <span
        role="presentation"
        onMouseDown={preventShiftSelect}
        onClickCapture={(event) => {
          shiftKey.current = event.shiftKey;
        }}
      >
        <Checkbox
          checked={isSelected}
          onCheckedChange={() => onToggle(item, { shiftKey: shiftKey.current })}
          aria-label={t('gallery.selection.toggle', { name: item.title })}
          data-testid="gallery-item-select"
          data-value={item.id}
        />
      </span>
      <button
        type="button"
        className="flex min-w-0 cursor-pointer items-center gap-3 border-0 bg-transparent p-0 text-left"
        onMouseDown={preventShiftSelect}
        onClick={(event) => (selecting || event.shiftKey ? onToggle(item, event) : onOpen(item))}
        data-testid="gallery-item"
        data-value={item.id}
      >
        <span
          className="relative size-12 shrink-0 overflow-hidden rounded-sm"
          // 主色是每張圖不同的資料，不是樣式（docs/architecture/backend/26-gallery.md D11）
          style={{ backgroundColor: item.dominantColor ?? undefined }}
        >
          <GalleryPlaceholder hash={item.placeholder} className="absolute inset-0 h-full w-full" />
          <SignedImage
            sources={item.image}
            variant="grid"
            sizes="48px"
            alt=""
            className="relative h-full w-full object-cover"
            onExpired={onGalleryImageExpired}
            isLongLived
          />
        </span>
        <span className="flex min-w-0 flex-col">
          <span className="truncate font-medium">{item.title}</span>
          {item.description && (
            <span className="truncate text-xs text-[var(--color-fg-muted)]">
              {item.description}
            </span>
          )}
        </span>
      </button>
      <span className="text-[var(--color-fg-muted)]">{date}</span>
      <span className="hidden text-[var(--color-fg-muted)] md:block">
        {item.width} × {item.height}
      </span>
      <span className="hidden text-[var(--color-fg-muted)] md:block">{formatBytes(item.size)}</span>
      <span className="hidden min-w-0 md:block">
        <TagChips tags={item.tags} empty="—" />
      </span>
    </div>
  );
});

/**
 * 列表的顯示方式（docs/architecture/frontend/24-gallery.md §3）：一列一張，看得到標題、說明、日期、尺寸、大小與標籤，
 * 適合依標題或資料找圖。不分組、沒有框選；點選、Shift 連續選取與檢視器和格子相同。
 */
export function GalleryList({
  ref,
  items,
  timeField,
  selected,
  selecting,
  hasMore,
  loading,
  onOpen,
  onToggle,
  onEndReached,
  stale,
  staleRevision,
  onStaleVisible,
}: GalleryListProps) {
  const { t } = useTranslation();
  return (
    <div
      className="flex min-h-0 min-w-0 flex-1 flex-col rounded-md border border-[var(--color-border)]"
      data-testid="gallery-list"
    >
      <div
        role="presentation"
        className={cn(
          'grid h-9 shrink-0 items-center gap-3 border-b border-[var(--color-border)] bg-[var(--color-fill-subtle)] px-3 text-xs font-semibold text-[var(--color-fg-muted)]',
          GRID_TEMPLATE,
        )}
      >
        <span />
        <span>{t('gallery.info.title')}</span>
        <span>
          {timeField === 'createdAt' ? t('gallery.info.createdAt') : t('gallery.info.takenAt')}
        </span>
        <span className="hidden md:block">{t('gallery.info.dimensions')}</span>
        <span className="hidden md:block">{t('gallery.list.fileSize')}</span>
        <span className="hidden md:block">{t('gallery.info.tags')}</span>
      </div>
      <VirtualList
        ref={ref}
        items={items}
        getKey={(item) => item.id}
        estimateSize={ROW_HEIGHT}
        virtualThreshold={0}
        hasMore={hasMore}
        loading={loading}
        onLoadMore={onEndReached}
        className="min-h-0 flex-1"
        aria-label={t('gallery.title')}
        renderItem={(item) => (
          <>
            <GalleryListRow
              item={item}
              date={formatDateTime(item[timeField])}
              isSelected={selected.has(item.id)}
              selecting={selecting}
              onOpen={onOpen}
              onToggle={onToggle}
            />
            {stale.has(item.id) && (
              <StaleItemTrigger id={item.id} revision={staleRevision} onVisible={onStaleVisible} />
            )}
          </>
        )}
      />
    </div>
  );
}
