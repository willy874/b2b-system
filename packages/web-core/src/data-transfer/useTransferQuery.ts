import { useQuery } from '@tanstack/react-query';

import { RealtimeStatus, useRealtimeStatus } from '../realtime';
import { ACTIVE_TRANSFER_STATUSES, TRANSFER_POLL_INTERVAL_MS } from './constants';
import type { DataTransferApi } from './types';

/**
 * 一筆傳輸的狀態：平常靠推播（`Resource.DATA_TRANSFER` 讓查詢失效）更新；推播斷線時，進行中的傳輸每 5 秒輪詢一次
 * （docs/architecture/backend/22-data-transfer.md §8.2）。
 */
export function useTransferQuery(
  api: Pick<DataTransferApi, 'transferKey' | 'fetchTransfer'>,
  id: string | null,
) {
  const realtime = useRealtimeStatus();
  return useQuery({
    queryKey: api.transferKey(id ?? ''),
    queryFn: ({ signal }) => api.fetchTransfer(id ?? '', signal),
    enabled: Boolean(id),
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      if (!status || !ACTIVE_TRANSFER_STATUSES.has(status)) return false;
      return realtime === RealtimeStatus.CONNECTED ? false : TRANSFER_POLL_INTERVAL_MS;
    },
  });
}
