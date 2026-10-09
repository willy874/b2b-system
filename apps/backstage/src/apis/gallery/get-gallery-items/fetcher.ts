import { defineAuthFetcher, withQuery } from '@b2b-system/web-core/client';
import type { HttpRequestDTO } from '@b2b-system/web-core/client';
import { toSortParams } from '@b2b-system/web-shared/constants';

import { getGalleryItemControllerListUrl } from '@/shared/api-sdk';
import type { GalleryItemList } from '@/shared/api-sdk';

import type { GalleryItemFilters } from '../types';

export interface GalleryItemListParams extends GalleryItemFilters {
  limit: number;
  cursor?: string;
  /** 快速捲動：第一頁從這個時間開始（帶 `cursor` 時忽略）。 */
  startAt?: string;
}

export const fetchGalleryItemsQuery = defineAuthFetcher<
  HttpRequestDTO<GalleryItemListParams>,
  GalleryItemList
>((http, request) =>
  http.request(
    withQuery(getGalleryItemControllerListUrl(), {
      ...request.params,
      sort: request.params.sort && toSortParams(request.params.sort),
    }),
    { method: 'GET' },
  ),
);
