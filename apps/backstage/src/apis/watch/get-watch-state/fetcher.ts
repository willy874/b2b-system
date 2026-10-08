import { defineAuthFetcher } from '@b2b-system/web-core/client';
import type { HttpRequestDTO } from '@b2b-system/web-core/client';

import type { CommentTargetParams } from '@/apis/comment/types';
import { getWatchControllerStateUrl } from '@/shared/api-sdk';
import type { WatchState } from '@/shared/api-sdk';

export const fetchWatchStateQuery = defineAuthFetcher<
  HttpRequestDTO<CommentTargetParams>,
  WatchState
>((http, request) => http.request(getWatchControllerStateUrl(request.params), { method: 'GET' }));
