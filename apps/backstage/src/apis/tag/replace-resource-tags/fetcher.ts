import { defineAuthFetcher, jsonBody } from '@b2b-system/web-core/client';
import type { HttpRequestDTO } from '@b2b-system/web-core/client';

import { getTagControllerReplaceUrl } from '@/shared/api-sdk';
import type { ResourceTags } from '@/shared/api-sdk';

import type { TaggableResourceType } from '../types';

export const fetchResourceTagsReplaceMutation = defineAuthFetcher<
  HttpRequestDTO<{ resourceType: TaggableResourceType; resourceId: string; tagIds: string[] }>,
  ResourceTags
>((http, request) =>
  http.request(
    getTagControllerReplaceUrl({
      resourceType: request.params.resourceType,
      resourceId: request.params.resourceId,
    }),
    jsonBody({ tagIds: request.params.tagIds }, { method: 'PUT' }),
  ),
);
