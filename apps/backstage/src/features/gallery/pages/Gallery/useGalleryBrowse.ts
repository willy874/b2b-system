import { useInfiniteQuery } from '@tanstack/react-query';
import { useNavigate, useParams } from '@tanstack/react-router';
import { useCallback, useMemo, useState } from 'react';

import { getGalleryItemsInfiniteQueryOptions } from '@/apis/gallery/get-gallery-items/query';
import type { GalleryItemFilters, GallerySortField } from '@/apis/gallery/types';
import type { GalleryItem } from '@/shared/api-sdk';

import { GalleryAlbumRoute, GalleryRoute } from '../../routes';
import type { GallerySearch } from '../../routes';
import type { GalleryGrouping } from './preference';
import { dayRangeToIso, groupGalleryItems } from './sections';

/** 預設的排序：圖片日期新到舊；標題預設 A→Z。 */
function orderOf(sort: GallerySortField, reverse: boolean | undefined): 'asc' | 'desc' {
  const natural = sort === 'title' ? 'asc' : 'desc';
  if (!reverse) return natural;
  return natural === 'asc' ? 'desc' : 'asc';
}

/** 網址的篩選 → api 的篩選（相簿頁多一個 `albumId`）。 */
export function filtersOf(search: GallerySearch, albumId: string | undefined): GalleryItemFilters {
  const sort = search.sort ?? 'sortAt';
  return {
    keyword: search.keyword || undefined,
    albumId,
    tagId: search.tag?.length ? search.tag : undefined,
    ...dayRangeToIso(search.from, search.to),
    orientation: search.orientation,
    origin: search.origin,
    sort: [{ sort, order: orderOf(sort, search.reverse) }],
  };
}

/**
 * 圖片庫的閱覽狀態（docs/architecture/frontend/24-gallery.md §3）：網址的篩選與排序、無限捲動、依日期分組、
 * 日期捲軸跳轉的起點。相簿頁與整個圖片庫共用（相簿頁只是多了 `albumId`）。
 */
export function useGalleryBrowse(grouping: GalleryGrouping) {
  const navigate = useNavigate();
  const params = useParams({ strict: false }) as { albumId?: string };
  const albumId = params.albumId;
  const search = (albumId ? GalleryAlbumRoute : GalleryRoute).useSearch();
  const filters = useMemo(() => filtersOf(search, albumId), [search, albumId]);
  const sortField = filters.sort?.[0]?.sort ?? 'sortAt';
  const order = filters.sort?.[0]?.order ?? 'desc';
  /** 日期捲軸跳到的位置（換了篩選就回到最前面）。 */
  const [jump, setJump] = useState<{ key: string; startAt: string }>();
  const filterKey = JSON.stringify(filters);
  const startAt = jump?.key === filterKey ? jump.startAt : undefined;

  const query = useInfiniteQuery(getGalleryItemsInfiniteQueryOptions(filters, { startAt }));
  const items = useMemo<GalleryItem[]>(
    () => query.data?.pages.flatMap((page) => page.items) ?? [],
    [query.data],
  );
  const timeField = sortField === 'title' ? null : sortField;
  const sections = useMemo(
    () => groupGalleryItems(items, grouping, timeField),
    [items, grouping, timeField],
  );

  /** `replace`：不留瀏覽紀錄（檢視器裡換上一張／下一張）。 */
  const updateSearch = useCallback(
    (patch: Partial<GallerySearch>, options?: { replace?: boolean }) => {
      const next: GallerySearch = { ...search, ...patch };
      const replace = options?.replace;
      if (albumId) {
        void navigate({ to: GalleryAlbumRoute.to, params: { albumId }, search: next, replace });
      } else void navigate({ to: GalleryRoute.to, search: next, replace });
    },
    [albumId, navigate, search],
  );

  const loadMore = useCallback(() => {
    if (query.hasNextPage && !query.isFetchingNextPage) void query.fetchNextPage();
  }, [query]);

  return {
    albumId,
    search,
    filters,
    sortField,
    order,
    timeField,
    items,
    sections,
    query,
    startAt,
    jumpTo: (next: string | undefined) =>
      setJump(next ? { key: filterKey, startAt: next } : undefined),
    updateSearch,
    loadMore,
  };
}
