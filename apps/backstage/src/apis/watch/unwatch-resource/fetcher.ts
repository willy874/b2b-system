import { defineAuthFetcher } from '@b2b-system/web-core/client';
import type { HttpRequestDTO } from '@b2b-system/web-core/client';

import type { CommentTargetParams } from '@/apis/comment/types';
import { getWatchControllerUnwatchUrl } from '@/shared/api-sdk';
import type { WatchState } from '@/shared/api-sdk';

export const fetchUnwatchMutation = defineAuthFetcher<
  HttpRequestDTO<CommentTargetParams>,
  WatchState
>((http, request) =>
  http.request(getWatchControllerUnwatchUrl(request.params), { method: 'DELETE' }),
);
