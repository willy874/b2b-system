import { defineAuthFetcher, jsonBody } from '@b2b-system/web-core/client';
import type { HttpRequestDTO } from '@b2b-system/web-core/client';

import { getImageControllerCreateFromSourceUrl } from '@/shared/api-sdk';
import type { CreateImageFromSourceRequest, ImageAsset } from '@/shared/api-sdk';

export const fetchCreateImageFromSourceMutation = defineAuthFetcher<
  HttpRequestDTO<CreateImageFromSourceRequest>,
  ImageAsset
>((http, request) =>
  http.request(
    getImageControllerCreateFromSourceUrl(),
    jsonBody(request.params, { method: 'POST' }),
  ),
);
