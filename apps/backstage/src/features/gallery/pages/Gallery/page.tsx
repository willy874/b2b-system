import { Button } from '@b2b-system/ui/Button';
import { Empty } from '@b2b-system/ui/Empty';
import { Skeleton } from '@b2b-system/ui/Skeleton';
import { useTranslation } from '@b2b-system/web-core/locales';
import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';

import { getGalleryAlbumsQueryOptions } from '@/apis/gallery/get-gallery-albums/query';
import { getGalleryTimelineQueryOptions } from '@/apis/gallery/get-gallery-timeline/query';

import {
  useGalleryAlbumRemoveItemsMutation,
  useGalleryAlbumUpdateMutation,
} from '../../hooks/useGalleryMutations';
import { useGalleryPermission } from '../../hooks/useGalleryPermission';
import { useGalleryUpload } from '../../hooks/useGalleryUpload';
import { GalleryAlbumBar } from './components/GalleryAlbumBar';
import { GalleryDialogs } from './components/GalleryDialogs';
import type { GalleryDialog } from './components/GalleryDialogs';
import { GalleryGrid } from './components/GalleryGrid';
import { GalleryHeader } from './components/GalleryHeader';
import { GallerySelectionBar } from './components/GallerySelectionBar';
import { GalleryTimeline } from './components/GalleryTimeline';
import { GalleryToolbar } from './components/GalleryToolbar';
import { GalleryViewer } from './components/GalleryViewer';
import { useGalleryViewPreference } from './preference';
import { startAtForMonth } from './sections';
import { useGalleryActions } from './useGalleryActions';
import { useGalleryBrowse } from './useGalleryBrowse';
import { useGalleryDrop } from './useGalleryDrop';
import { useGalleryGridState } from './useGalleryGridState';
import { useNarrowScreen } from './useNarrowScreen';

/**
 * 圖片庫（docs/architecture/frontend/24-gallery.md）：以看圖為主的素材庫。等高排列或方格、依日期分組的時間軸、
 * 右側的日期捲軸、多選與批次操作、檢視器；相簿頁是套了 `albumId` 的同一個頁面。
 */
export default function GalleryPage() {
  const { t } = useTranslation();
  const permission = useGalleryPermission();
  const view = useGalleryViewPreference();
  const narrow = useNarrowScreen();
  // 窄螢幕：方格、最小的列高（docs/architecture/frontend/24-gallery.md §3）
  const layout = narrow ? 'square' : view.layout;
  const rowHeight = narrow ? 120 : view.rowHeight;
  const browse = useGalleryBrowse(view.grouping);
  const { albumId, search, items, sections } = browse;
  const albums = useQuery(getGalleryAlbumsQueryOptions());
  const album = albums.data?.items.find((entry) => entry.id === albumId);
  const { sort: _sort, ...timelineFilters } = browse.filters;
  const timeline = useQuery({
    ...getGalleryTimelineQueryOptions(timelineFilters, browse.timeField ?? 'sortAt'),
    enabled: browse.timeField !== null,
  });
  const grid = useGalleryGridState(items, view.grouping);
  const { selection, setScrollElement } = grid;
  const actions = useGalleryActions();
  const upload = useGalleryUpload();
  const removeFromAlbum = useGalleryAlbumRemoveItemsMutation();
  const updateAlbum = useGalleryAlbumUpdateMutation();
  const [dialog, setDialog] = useState<GalleryDialog | null>(null);
  const drop = useGalleryDrop({
    enabled: permission.canCreate,
    onFiles: (files) => void upload(files, albumId),
  });
  const selectedItems = useMemo(
    () => items.filter((item) => selection.selected.has(item.id)),
    [items, selection.selected],
  );
  const openItem = (itemId: string | undefined) => browse.updateSearch({ item: itemId });
  const filtered = Boolean(search.keyword || search.tag || search.from || search.to);

  let content;
  if (browse.query.isPending) {
    content = <Skeleton width="100%" height={320} />;
  } else if (items.length === 0) {
    content = (
      <Empty
        title={filtered ? t('gallery.empty.filtered') : t('gallery.empty.title')}
        description={permission.canCreate ? t('gallery.empty.uploadHint') : undefined}
        data-testid="gallery-empty"
      />
    );
  } else {
    content = (
      <div className="flex min-h-0 flex-1 gap-2">
        <GalleryGrid
          ref={setScrollElement}
          sections={sections}
          labelOf={grid.labelOf}
          layout={layout}
          rowHeight={rowHeight}
          selected={selection.selected}
          selecting={selection.selected.size > 0}
          onOpen={(item) => openItem(item.id)}
          onToggle={selection.toggle}
          onSelectSection={(section) => selection.addAll(section.items.map((item) => item.id))}
          onEndReached={browse.loadMore}
          onLayoutChange={grid.onLayoutChange}
          onVisibleSectionChange={grid.setActiveSection}
          marquee={grid.marquee.marquee}
          onPointerDown={grid.marquee.onPointerDown}
        />
        {browse.timeField !== null && (
          <GalleryTimeline
            timeline={timeline.data}
            activeMonth={grid.activeSection?.slice(0, 7)}
            onJump={(month) => {
              browse.jumpTo(startAtForMonth(month, browse.order));
              grid.scrollElement?.scrollTo?.({ top: 0 });
            }}
          />
        )}
      </div>
    );
  }

  return (
    <div
      className="relative flex min-h-0 flex-1 flex-col gap-3"
      data-testid="gallery-page"
      data-dragging={drop.dragging || undefined}
      {...drop.handlers}
    >
      <GalleryHeader
        album={album}
        canCreate={permission.canCreate}
        canUpdate={permission.canUpdate}
        canDelete={permission.canDelete}
        onUpload={(collected) => void upload(collected, albumId)}
        onAddFromSources={() => setDialog({ kind: 'addFromSources' })}
        onEditAlbum={(target) => setDialog({ kind: 'albumForm', album: target })}
        onDeleteAlbum={(target) => setDialog({ kind: 'deleteAlbum', album: target })}
      />
      <GalleryAlbumBar
        albums={albums.data?.items ?? []}
        activeAlbumId={albumId}
        canCreate={permission.canCreate}
        onCreate={() => setDialog({ kind: 'albumForm' })}
      />
      <GalleryToolbar
        search={search}
        onSearchChange={browse.updateSearch}
        layout={layout}
        rowHeight={rowHeight}
        grouping={view.grouping}
        onViewChange={view.update}
      />
      {browse.startAt && (
        <div className="flex items-center gap-2 text-sm" data-testid="gallery-jumped">
          <span className="text-[var(--color-fg-muted)]">{t('gallery.timeline.jumped')}</span>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => browse.jumpTo(undefined)}
            data-testid="gallery-jump-reset"
          >
            {t('gallery.timeline.backToStart')}
          </Button>
        </div>
      )}
      <GallerySelectionBar
        count={selection.selected.size}
        loaded={items.length}
        canUpdate={permission.canUpdate}
        canDelete={permission.canDelete}
        inAlbum={albumId !== undefined}
        onSelectAll={() => selection.addAll(items.map((item) => item.id))}
        onClear={selection.clear}
        onAddToAlbum={() => setDialog({ kind: 'addToAlbum', itemIds: [...selection.selected] })}
        onRemoveFromAlbum={() =>
          albumId &&
          removeFromAlbum.mutate(
            { params: { albumId, body: { itemIds: [...selection.selected] } } },
            { onSuccess: selection.clear },
          )
        }
        onTag={() => setDialog({ kind: 'batchTag', items: selectedItems })}
        onDownload={() => void actions.downloadItems(selectedItems)}
        onDelete={() => setDialog({ kind: 'delete', items: selectedItems })}
      />
      {content}
      {drop.dragging && (
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 flex items-center justify-center rounded-md border-2 border-dashed border-[var(--color-brand)] bg-[var(--color-fill-subtle)] text-sm"
          data-testid="gallery-drop-overlay"
        >
          {t('gallery.upload.dropHint')}
        </div>
      )}
      {search.item && (
        <GalleryViewer
          itemId={search.item}
          items={items}
          filters={browse.filters}
          hasMore={browse.query.hasNextPage}
          onLoadMore={browse.loadMore}
          onNavigate={openItem}
          onClose={() => openItem(undefined)}
          canUpdate={permission.canUpdate}
          canDelete={permission.canDelete}
          onAddToAlbum={(itemId) => setDialog({ kind: 'addToAlbum', itemIds: [itemId] })}
          onTag={(item) => setDialog({ kind: 'tag', item })}
          onSetCover={
            album && permission.canUpdate
              ? (itemId) =>
                  updateAlbum.mutate({
                    params: {
                      albumId: album.id,
                      body: { version: album.version, coverItemId: itemId },
                    },
                  })
              : undefined
          }
        />
      )}
      <GalleryDialogs
        dialog={dialog}
        onClose={() => setDialog(null)}
        albumId={albumId}
        canCreate={permission.canCreate}
        onDeleteItems={actions.deleteItems}
        onSelectionDone={selection.clear}
      />
    </div>
  );
}
