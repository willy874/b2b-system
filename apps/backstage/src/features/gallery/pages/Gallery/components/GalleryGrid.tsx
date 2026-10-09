import { Icon } from '@b2b-system/ui/Icon';
import { JustifiedGrid } from '@b2b-system/ui/JustifiedGrid';
import type { GridItemRect, GridLayout, JustifiedGridHeader } from '@b2b-system/ui/JustifiedGrid';
import { SignedImage } from '@b2b-system/web-core/image';
import { useTranslation } from '@b2b-system/web-core/locales';
import { cn } from '@b2b-system/web-shared/utils';
import { memo, useMemo, useState } from 'react';
import type { MouseEvent, PointerEvent as ReactPointerEvent, Ref } from 'react';

import type { Rect } from '@/core/selection';
import type { GalleryItem } from '@/shared/api-sdk';

import { GalleryPlaceholder } from '../../../components/GalleryPlaceholder';
import type { GalleryLayout } from '../preference';
import type { GallerySection } from '../sections';

/** 格子之間的距離（px）。 */
const GAP = 4;

interface GalleryGridProps {
  ref?: Ref<HTMLDivElement>;
  sections: readonly GallerySection[];
  /** 區段的標題（日期）；不分組時沒有。 */
  labelOf: (section: GallerySection) => string | undefined;
  layout: Exclude<GalleryLayout, 'list'>;
  rowHeight: number;
  selected: ReadonlySet<string>;
  /** 有選取時點一下是切換選取，否則是打開檢視器。 */
  selecting: boolean;
  onOpen: (item: GalleryItem) => void;
  onToggle: (item: GalleryItem, event: MouseEvent) => void;
  onSelectSection: (section: GallerySection) => void;
  onEndReached: () => void;
  onLayoutChange: (layout: GridLayout) => void;
  onVisibleSectionChange: (key: string) => void;
  marquee: Rect | undefined;
  onPointerDown: (event: ReactPointerEvent<HTMLElement>) => void;
}

interface TileProps {
  item: GalleryItem;
  rect: GridItemRect;
  square: boolean;
  isSelected: boolean;
  selecting: boolean;
  onOpen: (item: GalleryItem) => void;
  onToggle: (item: GalleryItem, event: MouseEvent) => void;
}

/** 一格：主色當底、BlurHash 的模糊預覽、真正的圖載入後蓋上去（docs/architecture/frontend/24-gallery.md §3）。 */
const GalleryTile = memo(function GalleryTile({
  item,
  rect,
  square,
  isSelected,
  selecting,
  onOpen,
  onToggle,
}: TileProps) {
  const { t } = useTranslation();
  return (
    <div
      className="group relative h-full w-full overflow-hidden rounded-sm"
      // 主色是每張圖不同的資料，不是樣式（docs/architecture/backend/26-gallery.md D11）
      style={{ backgroundColor: item.dominantColor ?? undefined }}
      data-marquee-item
      data-selected={isSelected || undefined}
    >
      <GalleryPlaceholder hash={item.placeholder} className="absolute inset-0 h-full w-full" />
      <button
        type="button"
        className="absolute inset-0 block h-full w-full cursor-pointer border-0 bg-transparent p-0"
        aria-label={item.title}
        onClick={(event) => (selecting || event.shiftKey ? onToggle(item, event) : onOpen(item))}
        data-testid="gallery-item"
        data-value={item.id}
      >
        <SignedImage
          sources={item.image}
          variant="grid"
          sizes={`${Math.ceil(rect.width)}px`}
          alt={item.description ?? item.title}
          className={cn('h-full w-full', square ? 'object-cover' : 'object-fill')}
        />
      </button>
      <button
        type="button"
        aria-pressed={isSelected}
        aria-label={t('gallery.selection.toggle', { name: item.title })}
        className={cn(
          'absolute left-1 top-1 flex h-6 w-6 cursor-pointer items-center justify-center rounded-full border border-[var(--color-border)] bg-[var(--color-surface)] p-0 text-[var(--color-brand)] opacity-0 focus-visible:opacity-100 group-hover:opacity-100',
          (isSelected || selecting) && 'opacity-100',
        )}
        onClick={(event) => onToggle(item, event)}
        data-testid="gallery-item-select"
        data-value={item.id}
      >
        {isSelected && <Icon name="check" size={14} />}
      </button>
      {isSelected && (
        <span
          aria-hidden
          className="pointer-events-none absolute inset-0 rounded-sm border-4 border-[var(--color-brand)]"
        />
      )}
    </div>
  );
});

/**
 * 圖片的排版（docs/architecture/frontend/24-gallery.md §3）：`@b2b-system/ui` 的 `JustifiedGrid` 算版面與虛擬捲動，
 * 這裡只負責每一格的內容、區段標題與框選的矩形。尺寸在資料裡，版面不必等圖片載入。
 */
export function GalleryGrid({
  ref,
  sections,
  labelOf,
  layout,
  rowHeight,
  selected,
  selecting,
  onOpen,
  onToggle,
  onSelectSection,
  onEndReached,
  onLayoutChange,
  onVisibleSectionChange,
  marquee,
  onPointerDown,
}: GalleryGridProps) {
  const { t } = useTranslation();
  // 框選的矩形是內容座標，畫的時候扣掉捲動距離：只在框選期間追蹤（捲動事件不冒泡，以 capture 收）
  const [scrollTop, setScrollTop] = useState(0);
  const byKey = useMemo(() => {
    const map = new Map<string, GalleryItem>();
    for (const section of sections) for (const item of section.items) map.set(item.id, item);
    return map;
  }, [sections]);
  const sectionByKey = useMemo(
    () => new Map(sections.map((section) => [section.key, section])),
    [sections],
  );
  const gridSections = useMemo(
    () =>
      sections.map((section) => ({
        key: section.key,
        label: labelOf(section),
        items: section.items.map((item) => ({
          key: item.id,
          aspectRatio: item.height > 0 ? item.width / item.height : 1,
        })),
      })),
    [sections, labelOf],
  );
  const hasHeaders = gridSections.some((section) => section.label);

  const renderHeader = (header: JustifiedGridHeader) => {
    const section = sectionByKey.get(header.key);
    return (
      <div className="flex h-full items-center gap-2 bg-[var(--color-bg)] px-1 text-sm font-medium">
        <span>{header.label}</span>
        {section && (
          <button
            type="button"
            className="cursor-pointer border-0 bg-transparent p-0 text-xs text-[var(--color-brand)]"
            onClick={() => onSelectSection(section)}
            data-testid="gallery-section-select"
            data-value={section.key}
          >
            {t('gallery.selection.selectSection')}
          </button>
        )}
      </div>
    );
  };

  return (
    <div
      className="relative min-h-0 flex-1"
      onPointerDown={(event) => {
        setScrollTop((event.currentTarget.firstElementChild as HTMLElement | null)?.scrollTop ?? 0);
        onPointerDown(event);
      }}
      onScrollCapture={(event) => {
        if (marquee) setScrollTop((event.target as HTMLElement).scrollTop);
      }}
      data-testid="gallery-grid"
    >
      <JustifiedGrid
        ref={ref}
        sections={gridSections}
        mode={layout}
        rowHeight={rowHeight}
        gap={GAP}
        headerHeight={hasHeaders ? 40 : 0}
        renderHeader={hasHeaders ? renderHeader : undefined}
        onEndReached={onEndReached}
        onLayoutChange={onLayoutChange}
        onVisibleSectionChange={onVisibleSectionChange}
        className="h-full outline-none"
        aria-label={t('gallery.title')}
        renderItem={(rect) => {
          const item = byKey.get(rect.key);
          if (!item) return null;
          return (
            <GalleryTile
              item={item}
              rect={rect}
              square={layout === 'square'}
              isSelected={selected.has(item.id)}
              selecting={selecting}
              onOpen={onOpen}
              onToggle={onToggle}
            />
          );
        }}
      />
      {marquee && (
        <div
          aria-hidden
          className="pointer-events-none absolute border border-[var(--color-brand)] bg-[var(--color-fill)] opacity-60"
          // 框選的矩形是內容座標：扣掉捲動距離放回可視區（連續的值，允許 inline style）
          style={{
            left: marquee.left,
            top: marquee.top - scrollTop,
            width: marquee.width,
            height: marquee.height,
          }}
          data-testid="gallery-marquee"
        />
      )}
    </div>
  );
}
