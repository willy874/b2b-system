import { defineAuthFetcher } from '@b2b-system/web-core/client';
import type { HttpRequestDTO } from '@b2b-system/web-core/client';

import { getDataTransferControllerResourcesUrl } from '@/shared/api-sdk';
import type { DataTransferResourceList } from '@/shared/api-sdk';

export const fetchTransferResourcesQuery = defineAuthFetcher<
  HttpRequestDTO<void>,
  DataTransferResourceList
>((http) => http.request(getDataTransferControllerResourcesUrl(), { method: 'GET' }));
