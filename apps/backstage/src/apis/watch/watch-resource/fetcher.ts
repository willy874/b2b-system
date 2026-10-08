import { defineAuthFetcher } from '@b2b-system/web-core/client';
import type { HttpRequestDTO } from '@b2b-system/web-core/client';

import type { CommentTargetParams } from '@/apis/comment/types';
import { getWatchControllerWatchUrl } from '@/shared/api-sdk';
import type { WatchState } from '@/shared/api-sdk';

export const fetchWatchMutation = defineAuthFetcher<
  HttpRequestDTO<CommentTargetParams>,
  WatchState
>((http, request) => http.request(getWatchControllerWatchUrl(request.params), { method: 'PUT' }));
