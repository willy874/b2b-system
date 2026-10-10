import { defineAuthFetcher, jsonBody } from '@b2b-system/web-core/client';
import type { HttpRequestDTO } from '@b2b-system/web-core/client';

import { getTagControllerUpdateAssignmentsUrl } from '@/shared/api-sdk';
import type { ResourceTags } from '@/shared/api-sdk';

import type { TaggableResourceType } from '../types';

/** 差異語意：只加減指定的標籤（批次貼標籤用，不必先讀、不會蓋掉同時的編輯）。 */
export const fetchResourceTagsUpdateMutation = defineAuthFetcher<
  HttpRequestDTO<{
    resourceType: TaggableResourceType;
    resourceId: string;
    add?: string[];
    remove?: string[];
  }>,
  ResourceTags
>((http, request) =>
  http.request(
    getTagControllerUpdateAssignmentsUrl({
      resourceType: request.params.resourceType,
      resourceId: request.params.resourceId,
    }),
    jsonBody(
      { add: request.params.add ?? [], remove: request.params.remove ?? [] },
      { method: 'PATCH' },
    ),
  ),
);
