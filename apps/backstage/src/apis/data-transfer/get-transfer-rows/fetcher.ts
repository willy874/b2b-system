import { defineAuthFetcher, withQuery } from '@b2b-system/web-core/client';
import type { HttpRequestDTO } from '@b2b-system/web-core/client';

import { getDataTransferControllerRowsUrl } from '@/shared/api-sdk';
import type { DataTransferApplyRowList } from '@/shared/api-sdk';

import type { RowOutcome } from '../types';

export interface TransferRowsParams {
  transferId: string;
  outcome?: RowOutcome[];
  afterRowNo?: number;
  limit: number;
}

export const fetchTransferRowsQuery = defineAuthFetcher<
  HttpRequestDTO<TransferRowsParams>,
  DataTransferApplyRowList
>((http, { params: { transferId, ...query } }) =>
  http.request(withQuery(getDataTransferControllerRowsUrl({ id: transferId }), { ...query }), {
    method: 'GET',
  }),
);
