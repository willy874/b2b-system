import { Button } from '@b2b-system/ui/Button';
import { Empty } from '@b2b-system/ui/Empty';
import { Input } from '@b2b-system/ui/Input';
import { Select } from '@b2b-system/ui/Select';
import { Skeleton } from '@b2b-system/ui/Skeleton';
import { SignedImage } from '@b2b-system/web-core/image';
import type { ImageSourceProps, ImageUsage } from '@b2b-system/web-core/image-picker';
import { isLargeEnough } from '@b2b-system/web-core/image-picker';
import { useTranslation } from '@b2b-system/web-core/locales';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useState } from 'react';

import { getGalleryAlbumsQueryOptions } from '@/apis/gallery/get-gallery-albums/query';
import { getGalleryItemsQueryOptions } from '@/apis/gallery/get-gallery-items/query';
import type { GalleryItem } from '@/shared/api-sdk';

import { GALLERY_IMAGE_SOURCE_ID } from './register';

/** 一頁幾張：方格一次放得下，再多就按「載入更多」。 */
const PAGE_SIZE = 48;
/** Select 的「全部相簿」。 */
const ALL_ALBUMS = '*';

function isTooSmall(item: GalleryItem, usage: ImageUsage): boolean {
  return !isLargeEnough({ width: item.width, height: item.height }, usage);
}

/**
 * 來源「圖片庫」（docs/architecture/frontend/24-gallery.md §7）：精簡版的列表——相簿切換、搜尋、方格。
 * 伺服器以用途過濾型別與大小（`imageUsage`）；尺寸太小的列出但停用（使用者記得圖片庫裡有那張，找不到會以為壞了）。
 */
export function GalleryImageSource({ usage, onSelect }: ImageSourceProps) {
  const { t } = useTranslation();
  const [albumId, setAlbumId] = useState(ALL_ALBUMS);
  const [keyword, setKeyword] = useState('');
  const [limit, setLimit] = useState(PAGE_SIZE);
  const albums = useQuery(getGalleryAlbumsQueryOptions());
  const items = useQuery({
    ...getGalleryItemsQueryOptions(
      {
        imageUsage: usage.id,
        albumId: albumId === ALL_ALBUMS ? undefined : albumId,
        keyword: keyword.trim() || undefined,
      },
      limit,
    ),
    placeholderData: keepPreviousData,
  });
  const list = items.data?.items ?? [];

  return (
    <div className="flex flex-col gap-3" data-testid="gallery-image-source">
      <div className="flex flex-wrap gap-2">
        <Select
          options={[
            { value: ALL_ALBUMS, label: t('gallery.album.all') },
            ...(albums.data?.items ?? []).map((album) => ({ value: album.id, label: album.name })),
          ]}
          value={albumId}
          onValueChange={(value) => {
            setAlbumId(value);
            setLimit(PAGE_SIZE);
          }}
          aria-label={t('gallery.album.label')}
          className="min-w-40"
          data-testid="gallery-image-source-album"
        />
        <Input
          value={keyword}
          onChange={(event) => setKeyword(event.target.value)}
          placeholder={t('gallery.filter.keyword')}
          aria-label={t('gallery.filter.keyword')}
          className="min-w-40 flex-1"
          data-testid="gallery-image-source-keyword"
        />
      </div>
      {items.isPending ? (
        <Skeleton width="100%" height={160} />
      ) : list.length === 0 ? (
        <Empty
          title={t('gallery.imageSource.empty')}
          description={t('gallery.imageSource.emptyHint')}
        />
      ) : (
        <ul className="m-0 grid max-h-96 list-none grid-cols-[repeat(auto-fill,minmax(112px,1fr))] gap-3 overflow-auto p-0">
          {list.map((item) => {
            const tooSmall = isTooSmall(item, usage);
            const label = tooSmall
              ? t('gallery.imageSource.tooSmall', {
                  name: item.title,
                  width: usage.minWidth,
                  height: usage.minHeight,
                })
              : item.title;
            const medium = item.image.variants.medium;
            return (
              <li key={item.id}>
                <button
                  type="button"
                  disabled={tooSmall}
                  title={label}
                  aria-label={label}
                  className="flex w-full cursor-pointer flex-col gap-1 border-0 bg-transparent p-0 text-left disabled:cursor-not-allowed disabled:opacity-50"
                  onClick={() =>
                    onSelect({
                      kind: 'source',
                      source: GALLERY_IMAGE_SOURCE_ID,
                      refId: item.id,
                      name: item.title,
                      preview: medium
                        ? { src: medium.src, width: item.width, height: item.height }
                        : null,
                    })
                  }
                  data-testid="gallery-image-source-item"
                  data-value={item.id}
                >
                  <span
                    className="block aspect-square w-full overflow-hidden rounded-md border border-[var(--color-border)]"
                    // 主色是每張圖不同的資料，不是樣式（docs/architecture/backend/26-gallery.md D11）
                    style={{ backgroundColor: item.dominantColor ?? undefined }}
                  >
                    <SignedImage
                      sources={item.image}
                      variant="grid"
                      sizes="112px"
                      alt=""
                      className="h-full w-full object-cover"
                    />
                  </span>
                  <span className="truncate text-xs">{item.title}</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {items.data?.nextCursor && (
        <Button
          variant="ghost"
          loading={items.isFetching}
          onClick={() => setLimit((current) => current + PAGE_SIZE)}
        >
          {t('gallery.imageSource.more')}
        </Button>
      )}
    </div>
  );
}
