import { defineAuthFetcher, jsonBody } from '@b2b-system/web-core/client';
import type { HttpRequestDTO } from '@b2b-system/web-core/client';

import { getGalleryItemControllerCreateFromSourceUrl } from '@/shared/api-sdk';
import type { CreateGalleryFromSourceRequest, GalleryFromSourceResult } from '@/shared/api-sdk';

export const fetchGalleryFromSourceMutation = defineAuthFetcher<
  HttpRequestDTO<{ body: CreateGalleryFromSourceRequest }>,
  GalleryFromSourceResult
>((http, request) =>
  http.request(
    getGalleryItemControllerCreateFromSourceUrl(),
    jsonBody(request.params.body, { method: 'POST' }),
  ),
);
