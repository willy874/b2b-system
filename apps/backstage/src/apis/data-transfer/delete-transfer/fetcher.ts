import { defineAuthFetcher } from '@b2b-system/web-core/client';
import type { HttpRequestDTO } from '@b2b-system/web-core/client';

import { getDataTransferControllerRemoveUrl } from '@/shared/api-sdk';

export const fetchDeleteTransferMutation = defineAuthFetcher<
  HttpRequestDTO<{ transferId: string }>,
  void
>((http, { params }) =>
  http.request(getDataTransferControllerRemoveUrl({ id: params.transferId }), { method: 'DELETE' }),
);
