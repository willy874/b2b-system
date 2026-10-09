import { Empty } from '@b2b-system/ui/Empty';
import { Skeleton } from '@b2b-system/ui/Skeleton';
import { useTranslation } from '@b2b-system/web-core/locales';
import { useQuery } from '@tanstack/react-query';

import { getGalleryTimelineQueryOptions } from '@/apis/gallery/get-gallery-timeline/query';
import type { GalleryItem } from '@/shared/api-sdk';

import type { GalleryRowHeight } from '../../../constants';
import type { GalleryLayout } from '../preference';
import { startAtForMonth } from '../sections';
import type { useGalleryBrowse } from '../useGalleryBrowse';
import type { useGalleryGridState } from '../useGalleryGridState';
import { GalleryGrid } from './GalleryGrid';
import { GalleryList } from './GalleryList';
import { GalleryTimeline } from './GalleryTimeline';

interface GalleryContentProps {
  browse: ReturnType<typeof useGalleryBrowse>;
  grid: ReturnType<typeof useGalleryGridState>;
  layout: GalleryLayout;
  rowHeight: GalleryRowHeight;
  canCreate: boolean;
  onOpen: (item: GalleryItem) => void;
}

/**
 * 圖片的主區塊（docs/architecture/frontend/24-gallery.md §3）：載入中、空狀態，或依顯示方式的格子／列表加上右側的日期捲軸。
 */
export function GalleryContent({
  browse,
  grid,
  layout,
  rowHeight,
  canCreate,
  onOpen,
}: GalleryContentProps) {
  const { t } = useTranslation();
  const { search, items } = browse;
  const { selection, setScrollElement } = grid;
  const { sort: _sort, ...timelineFilters } = browse.filters;
  const timeline = useQuery({
    ...getGalleryTimelineQueryOptions(timelineFilters, browse.timeField ?? 'sortAt'),
    enabled: browse.timeField !== null,
  });

  if (browse.query.isPending) return <Skeleton width="100%" height={320} />;
  if (items.length === 0) {
    const filtered = Boolean(
      search.keyword ||
      search.tag ||
      search.from ||
      search.to ||
      search.orientation ||
      search.origin,
    );
    return (
      <Empty
        title={filtered ? t('gallery.empty.filtered') : t('gallery.empty.title')}
        description={canCreate ? t('gallery.empty.uploadHint') : undefined}
        data-testid="gallery-empty"
      />
    );
  }

  const selecting = selection.selected.size > 0;
  return (
    <div className="flex min-h-0 flex-1 gap-2">
      {layout === 'list' ? (
        <GalleryList
          ref={setScrollElement}
          items={items}
          timeField={browse.timeField ?? 'sortAt'}
          selected={selection.selected}
          selecting={selecting}
          hasMore={browse.query.hasNextPage}
          loading={browse.query.isFetchingNextPage}
          onOpen={onOpen}
          onToggle={selection.toggle}
          onEndReached={browse.loadMore}
        />
      ) : (
        <GalleryGrid
          ref={setScrollElement}
          sections={browse.sections}
          labelOf={grid.labelOf}
          layout={layout}
          rowHeight={rowHeight}
          selected={selection.selected}
          selecting={selecting}
          onOpen={onOpen}
          onToggle={selection.toggle}
          onSelectSection={(section) => selection.addAll(section.items.map((item) => item.id))}
          onEndReached={browse.loadMore}
          onLayoutChange={grid.onLayoutChange}
          onVisibleSectionChange={grid.setActiveSection}
          marquee={grid.marquee.marquee}
          onPointerDown={grid.marquee.onPointerDown}
        />
      )}
      {browse.timeField !== null && (
        <GalleryTimeline
          timeline={timeline.data}
          activeMonth={layout === 'list' ? undefined : grid.activeSection?.slice(0, 7)}
          onJump={(month) => {
            browse.jumpTo(startAtForMonth(month, browse.order));
            grid.scrollElement?.scrollTo?.({ top: 0 });
          }}
        />
      )}
    </div>
  );
}
