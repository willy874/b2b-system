import { AlertDialog } from '@b2b-system/ui/AlertDialog';
import { Button, IconButton } from '@b2b-system/ui/Button';
import { Dialog } from '@b2b-system/ui/Dialog';
import { Empty } from '@b2b-system/ui/Empty';
import { Icon } from '@b2b-system/ui/Icon';
import { ImageViewer } from '@b2b-system/ui/ImageViewer';
import type { ImageViewerController, ImageViewerLevel } from '@b2b-system/ui/ImageViewer';
import { Menu } from '@b2b-system/ui/Menu';
import { Spinner } from '@b2b-system/ui/Spinner';
import { isAppError } from '@b2b-system/web-core/errors';
import { SignedImage } from '@b2b-system/web-core/image';
import type { ImageSourceVariant, ImageSources } from '@b2b-system/web-core/image';
import { useTranslation } from '@b2b-system/web-core/locales';
import { cn } from '@b2b-system/web-shared/utils';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState } from 'react';

import { getGalleryItemQueryOptions } from '@/apis/gallery/get-gallery-item/query';
import { getGalleryNeighborsQueryOptions } from '@/apis/gallery/get-gallery-neighbors/query';
import type { GalleryItemFilters } from '@/apis/gallery/types';
import type { GalleryItem, GalleryItemDetail } from '@/shared/api-sdk';

import { GALLERY_PRELOAD_NEIGHBORS, GALLERY_SLIDESHOW_INTERVALS } from '../../../constants';
import {
  useGalleryItemDeleteMutation,
  useGalleryItemUpdateMutation,
} from '../../../hooks/useGalleryMutations';
import { preloadImageVariant } from '../preload';
import { GalleryInfoPanel } from './GalleryInfoPanel';

interface GalleryViewerProps {
  itemId: string;
  /** 目前列表已載入的圖片：上一張／下一張在這之中切換，到了最後一張就載入下一頁。 */
  items: readonly GalleryItem[];
  filters: GalleryItemFilters;
  hasMore: boolean;
  onLoadMore: () => void;
  onNavigate: (itemId: string) => void;
  onClose: () => void;
  canUpdate: boolean;
  canDelete: boolean;
  onAddToAlbum: (itemId: string) => void;
  onTag: (item: GalleryItemDetail) => void;
  /** 在相簿頁：可以設為封面。 */
  onSetCover?: (itemId: string) => void;
}

/** 切到前後時預先抓 `large`（與檢視器同一個 `<picture>` 結構，抓的是瀏覽器會顯示的格式）：換圖時立刻顯示。 */
function usePreload(sources: ReadonlyArray<ImageSources | undefined>): void {
  const variants = sources.flatMap((source) => {
    const large = source?.variants.large;
    return large ? [large] : [];
  });
  // 網址字串當作依賴：查詢重抓得到同樣的網址時不重做（簽章網址在同一個時間窗內不變）
  const key = JSON.stringify(
    variants.map(({ src, sources: formats }) => ({ src, sources: formats })),
  );
  useEffect(() => {
    const parsed = JSON.parse(key) as Array<Pick<ImageSourceVariant, 'src' | 'sources'>>;
    for (const variant of parsed) preloadImageVariant(variant);
  }, [key]);
}

/** 由小到大的解析度：medium（多半已在快取）→ large → 原檔（放大超過 large 時才載入）。 */
function levelsOf(item: GalleryItem, detail: GalleryItemDetail | undefined): ImageViewerLevel[] {
  const levels: ImageViewerLevel[] = [];
  for (const name of ['medium', 'large'] as const) {
    const variant = item.image.variants[name];
    if (!variant) continue;
    if (levels.some((level) => level.width >= variant.width)) continue;
    levels.push({
      src: variant.src,
      width: variant.width,
      height: variant.height,
      sources: variant.sources,
    });
  }
  const original = detail?.original;
  if (original && levels.every((level) => level.width < original.width)) {
    levels.push({ src: original.url, width: original.width, height: original.height });
  }
  return levels;
}

function prefersReducedMotion(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * 檢視器（docs/architecture/frontend/24-gallery.md §9）：縮放與平移（`@b2b-system/ui` 的 `ImageViewer`）、
 * 整個結果之間的上一張與下一張、底片列、幻燈片、全螢幕、資訊面板與留言。網址帶 `?item=<id>`，可以直接分享。
 * 按鍵寫在元件裡（只在檢視器開著時有效，與檔案管理器的 LightBox 相同；全域快捷鍵的註冊表只放整個 app 的入口）。
 */
export function GalleryViewer({
  itemId,
  items,
  filters,
  hasMore,
  onLoadMore,
  onNavigate,
  onClose,
  canUpdate,
  canDelete,
  onAddToAlbum,
  onTag,
  onSetCover,
}: GalleryViewerProps) {
  const { t } = useTranslation();
  const root = useRef<HTMLDivElement>(null);
  const viewer = useRef<ImageViewerController>(null);
  const filmstrip = useRef<HTMLDivElement>(null);
  const [showInfo, setShowInfo] = useState(true);
  const [slideshow, setSlideshow] = useState<number | null>(null);
  const [interval, setIntervalSeconds] = useState<number>(GALLERY_SLIDESHOW_INTERVALS[1]);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const update = useGalleryItemUpdateMutation();
  const remove = useGalleryItemDeleteMutation();

  const detail = useQuery(getGalleryItemQueryOptions(itemId));
  const deleted = isAppError(detail.error) && detail.error.code === 'GALLERY_ITEM_NOT_FOUND';
  const index = items.findIndex((item) => item.id === itemId);
  const listed = index >= 0 ? items[index] : undefined;
  // 從分享的網址直接打開、這一張不在已載入的列表裡：向後端問前後一張
  const neighbors = useQuery({
    ...getGalleryNeighborsQueryOptions(itemId, filters),
    enabled: index < 0,
  });
  const item: GalleryItem | undefined = listed ?? detail.data;
  const previousId = index >= 0 ? items[index - 1]?.id : (neighbors.data?.previousId ?? undefined);
  const nextId = index >= 0 ? items[index + 1]?.id : (neighbors.data?.nextId ?? undefined);

  // 快到已載入的最後一張就載入下一頁：← / → 一路看到最後一張，不必關掉檢視器
  useEffect(() => {
    if (index >= 0 && hasMore && index >= items.length - 1 - GALLERY_PRELOAD_NEIGHBORS)
      onLoadMore();
  }, [hasMore, index, items.length, onLoadMore]);

  usePreload(
    index >= 0
      ? Array.from({ length: GALLERY_PRELOAD_NEIGHBORS * 2 + 1 }, (_, offset) => {
          const neighbour = items[index - GALLERY_PRELOAD_NEIGHBORS + offset];
          return neighbour && neighbour.id !== itemId ? neighbour.image : undefined;
        })
      : [],
  );

  // 被刪除（推播或查詢得知）：顯示「圖片已被刪除」，自動前往下一張
  useEffect(() => {
    if (!deleted) return undefined;
    const next = nextId ?? previousId;
    if (!next) return undefined;
    const timer = setTimeout(() => onNavigate(next), 1500);
    return () => clearTimeout(timer);
  }, [deleted, nextId, onNavigate, previousId]);

  // 幻燈片：到最後一張就停
  useEffect(() => {
    if (slideshow === null) return undefined;
    const timer = setTimeout(() => {
      if (nextId) onNavigate(nextId);
      else setSlideshow(null);
    }, slideshow * 1000);
    return () => clearTimeout(timer);
  }, [slideshow, nextId, onNavigate, itemId]);

  const toggleFullscreen = () => {
    if (document.fullscreenElement) void document.exitFullscreen?.();
    else void root.current?.requestFullscreen?.();
  };
  const toggleSlideshow = () => setSlideshow((current) => (current === null ? interval : null));

  // 用 capture：Base UI Dialog 的焦點管理會在事件冒泡到 window 之前停止傳遞。輸入框（標題、說明）不攔截
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target instanceof HTMLElement ? event.target : null;
      if (
        event.defaultPrevented ||
        event.metaKey ||
        event.ctrlKey ||
        event.altKey ||
        target?.closest(
          'input, textarea, select, [contenteditable], [role="listbox"], [role="combobox"], [role="menu"]',
        )
      ) {
        return;
      }
      const handled = (() => {
        switch (event.key) {
          case 'ArrowLeft':
            if (previousId) onNavigate(previousId);
            return true;
          case 'ArrowRight':
            if (nextId) onNavigate(nextId);
            return true;
          case ' ':
            toggleSlideshow();
            return true;
          case 'f':
          case 'F':
            toggleFullscreen();
            return true;
          case 'i':
          case 'I':
            setShowInfo((current) => !current);
            return true;
          case '+':
          case '=':
            viewer.current?.zoomIn();
            return true;
          case '-':
            viewer.current?.zoomOut();
            return true;
          case '0':
            viewer.current?.toggle();
            return true;
          default:
            return false;
        }
      })();
      if (handled) event.preventDefault();
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  });

  // 底片列：目前這一張捲到中間
  useEffect(() => {
    const strip = filmstrip.current;
    const current = strip?.querySelector<HTMLElement>(`[data-current="true"]`);
    current?.scrollIntoView?.({ block: 'nearest', inline: 'center' });
  }, [itemId]);

  const levels = useMemo(() => (item ? levelsOf(item, detail.data) : []), [item, detail.data]);
  const animate = !prefersReducedMotion();
  const rotate = (delta: number) => {
    const current = detail.data;
    if (!current) return;
    const next = (((current.displayRotation + delta) % 360) + 360) % 360;
    update.mutate({
      params: {
        itemId,
        body: { version: current.version, displayRotation: next as 0 | 90 | 180 | 270 },
      },
    });
  };

  let body;
  if (deleted) {
    body = (
      <Empty
        title={t('gallery.viewer.deleted')}
        description={nextId || previousId ? t('gallery.viewer.deletedNext') : undefined}
        data-testid="gallery-viewer-deleted"
      />
    );
  } else if (!item) {
    body = (
      <div className="flex h-full items-center justify-center">
        <Spinner label={t('common.loading')} />
      </div>
    );
  } else {
    body = (
      <ImageViewer
        key={item.id}
        controllerRef={viewer}
        levels={levels}
        width={levels.at(-1)?.width ?? item.width}
        height={levels.at(-1)?.height ?? item.height}
        alt={item.description ?? item.title}
        // 主色是資料（docs/architecture/backend/26-gallery.md D11）
        placeholderColor={item.dominantColor ?? undefined}
        onSwipe={(direction) => {
          const target = direction === 'next' ? nextId : previousId;
          if (target) onNavigate(target);
        }}
        labels={{
          zoomIn: t('gallery.viewer.zoomIn'),
          zoomOut: t('gallery.viewer.zoomOut'),
          fit: t('gallery.viewer.fit'),
          actualSize: t('gallery.viewer.actualSize'),
        }}
        className={cn('h-full w-full', animate && 'transition-opacity')}
        data-testid="gallery-viewer-image"
      />
    );
  }

  const current = detail.data;
  return (
    <Dialog
      open
      onOpenChange={(open) => !open && onClose()}
      title={
        <span className="flex items-center gap-2" data-testid="gallery-viewer-title">
          <span className="truncate">{item?.title ?? t('gallery.viewer.title')}</span>
          {index >= 0 && (
            <span className="shrink-0 text-xs font-normal text-[var(--color-fg-muted)]">
              {t('gallery.viewer.position', { index: index + 1, total: items.length })}
            </span>
          )}
        </span>
      }
      className="!top-0 !left-0 !h-dvh !max-h-none !w-screen !max-w-none !transform-none !animate-none !rounded-none"
      classNames={{ body: 'flex min-h-0 flex-1 flex-col gap-0 !p-0 md:flex-row' }}
      data-testid="gallery-viewer"
      footer={
        <div className="flex w-full flex-wrap items-center gap-2">
          <IconButton
            aria-label={t('gallery.viewer.previous')}
            disabled={!previousId}
            onClick={() => previousId && onNavigate(previousId)}
            data-testid="gallery-viewer-previous"
          >
            <Icon name="chevron-left" size={16} />
          </IconButton>
          <IconButton
            aria-label={t('gallery.viewer.next')}
            disabled={!nextId}
            onClick={() => nextId && onNavigate(nextId)}
            data-testid="gallery-viewer-next"
          >
            <Icon name="chevron-right" size={16} />
          </IconButton>
          <Button
            size="sm"
            variant={slideshow === null ? 'secondary' : 'primary'}
            onClick={toggleSlideshow}
            aria-pressed={slideshow !== null}
            data-testid="gallery-viewer-slideshow"
          >
            {slideshow === null ? t('gallery.viewer.slideshow') : t('gallery.viewer.pause')}
          </Button>
          <Menu
            trigger={
              <Button size="sm" variant="ghost" data-testid="gallery-viewer-interval">
                {t('gallery.viewer.interval', { seconds: interval })}
              </Button>
            }
            items={GALLERY_SLIDESHOW_INTERVALS.map((seconds) => ({
              key: String(seconds),
              textValue: t('gallery.viewer.interval', { seconds }),
              label: t('gallery.viewer.interval', { seconds }),
              onSelect: () => {
                setIntervalSeconds(seconds);
                if (slideshow !== null) setSlideshow(seconds);
              },
            }))}
          />
          <IconButton
            aria-label={t('gallery.viewer.fullscreen')}
            onClick={toggleFullscreen}
            data-testid="gallery-viewer-fullscreen"
          >
            <Icon name="maximize" size={16} />
          </IconButton>
          <IconButton
            aria-label={t('gallery.viewer.info')}
            aria-pressed={showInfo}
            onClick={() => setShowInfo((value) => !value)}
            data-testid="gallery-viewer-info"
          >
            <Icon name="info" size={16} />
          </IconButton>
          <span className="ml-auto flex flex-wrap items-center gap-2">
            {current && !deleted && canUpdate && (
              <>
                <IconButton
                  aria-label={t('gallery.viewer.rotateLeft')}
                  disabled={update.isPending}
                  onClick={() => rotate(-90)}
                  data-testid="gallery-viewer-rotate-left"
                >
                  <Icon name="undo" size={16} />
                </IconButton>
                <IconButton
                  aria-label={t('gallery.viewer.rotateRight')}
                  disabled={update.isPending}
                  onClick={() => rotate(90)}
                  data-testid="gallery-viewer-rotate-right"
                >
                  <Icon name="redo" size={16} />
                </IconButton>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => onAddToAlbum(itemId)}
                  data-testid="gallery-viewer-add-to-album"
                >
                  {t('gallery.album.add.action')}
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => onTag(current)}
                  data-testid="gallery-viewer-tag"
                >
                  {t('tag.assign.action')}
                </Button>
                {onSetCover && (
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => onSetCover(itemId)}
                    data-testid="gallery-viewer-set-cover"
                  >
                    {t('gallery.album.setCover')}
                  </Button>
                )}
              </>
            )}
            {current && !deleted && (
              <Menu
                align="end"
                trigger={
                  <Button
                    size="sm"
                    variant="secondary"
                    startIcon={<Icon name="download" size={14} />}
                    data-testid="gallery-viewer-download"
                  >
                    {t('gallery.download.action')}
                  </Button>
                }
                items={[
                  {
                    key: 'original',
                    textValue: t('gallery.download.original'),
                    label: t('gallery.download.original'),
                    render: (
                      <a
                        aria-label={t('gallery.download.original')}
                        href={current.download.original}
                        download
                        data-testid="gallery-viewer-download-original"
                      />
                    ),
                  },
                  {
                    key: 'large',
                    textValue: t('gallery.download.large'),
                    label: t('gallery.download.large'),
                    render: (
                      <a
                        aria-label={t('gallery.download.large')}
                        href={current.download.large}
                        download
                        data-testid="gallery-viewer-download-large"
                      />
                    ),
                  },
                ]}
              />
            )}
            {current && !deleted && canDelete && (
              <Button
                size="sm"
                variant="danger"
                startIcon={<Icon name="trash" size={14} />}
                onClick={() => setConfirmDelete(true)}
                data-testid="gallery-viewer-delete"
              >
                {t('common.delete')}
              </Button>
            )}
          </span>
        </div>
      }
    >
      <div ref={root} className="flex min-h-0 min-w-0 flex-1 flex-col bg-[var(--color-surface)]">
        <div className="relative min-h-[40dvh] min-w-0 flex-1">{body}</div>
        {items.length > 1 && (
          <div
            ref={filmstrip}
            className="hidden h-20 shrink-0 gap-1 overflow-x-auto p-2 md:flex"
            data-testid="gallery-filmstrip"
          >
            {items.map((entry) => (
              <button
                key={entry.id}
                type="button"
                className={cn(
                  'h-16 shrink-0 cursor-pointer overflow-hidden rounded-sm border-2 border-transparent p-0 opacity-60',
                  entry.id === itemId && 'border-[var(--color-brand)] opacity-100',
                )}
                // 依比例的寬度與主色是資料（連續的值，允許 inline style）
                style={{
                  width: Math.max(32, Math.round((64 * entry.width) / Math.max(1, entry.height))),
                  backgroundColor: entry.dominantColor ?? undefined,
                }}
                aria-label={entry.title}
                aria-current={entry.id === itemId ? 'true' : undefined}
                data-current={entry.id === itemId}
                onClick={() => onNavigate(entry.id)}
                data-testid="gallery-filmstrip-item"
                data-value={entry.id}
              >
                <SignedImage
                  sources={entry.image}
                  variant="grid"
                  sizes="128px"
                  alt=""
                  className="h-full w-full object-cover"
                />
              </button>
            ))}
          </div>
        )}
      </div>
      {showInfo && current && !deleted && (
        <GalleryInfoPanel
          key={`${current.id}:${current.version}`}
          item={current}
          canUpdate={canUpdate}
          saving={update.isPending}
          onSave={(patch) =>
            update.mutate({ params: { itemId, body: { version: current.version, ...patch } } })
          }
          onOpenDuplicate={onNavigate}
        />
      )}
      <AlertDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title={t('gallery.delete.title', { count: 1 })}
        description={t('gallery.delete.description')}
        confirmLabel={t('common.delete')}
        cancelLabel={t('common.cancel')}
        tone="danger"
        loading={remove.isPending}
        onConfirm={async () => {
          await remove.mutateAsync({ params: { itemId } });
          setConfirmDelete(false);
          const next = nextId ?? previousId;
          if (next) onNavigate(next);
          else onClose();
        }}
        data-testid="gallery-viewer-delete-confirm"
      />
    </Dialog>
  );
}
