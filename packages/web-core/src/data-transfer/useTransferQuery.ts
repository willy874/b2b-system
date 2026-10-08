import { useQuery } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';

import { RealtimeStatus, useRealtimeStatus } from '../realtime';
import {
  ACTIVE_TRANSFER_STATUSES,
  TRANSFER_POLL_INTERVAL_MS,
  TRANSFER_SAFETY_POLL_INTERVAL_MS,
} from './constants';
import type { DataTransferApi } from './types';

/**
 * 一筆傳輸的狀態：平常靠推播（`Resource.DATA_TRANSFER` 讓查詢失效）更新；推播斷線時，進行中的傳輸每 5 秒輪詢一次
 * （docs/architecture/backend/22-data-transfer.md §8.2）。斷線期間完成的傳輸收不到推播，所以重新連上時重查一次；
 * 連線中也以較慢的間隔輪詢，推播萬一漏掉，畫面不會一直停在「排隊中」。
 */
export function useTransferQuery(
  api: Pick<DataTransferApi, 'transferKey' | 'fetchTransfer'>,
  id: string | null,
) {
  const realtime = useRealtimeStatus();
  const query = useQuery({
    queryKey: api.transferKey(id ?? ''),
    queryFn: ({ signal }) => api.fetchTransfer(id ?? '', signal),
    enabled: Boolean(id),
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      if (!status || !ACTIVE_TRANSFER_STATUSES.has(status)) return false;
      return realtime === RealtimeStatus.CONNECTED
        ? TRANSFER_SAFETY_POLL_INTERVAL_MS
        : TRANSFER_POLL_INTERVAL_MS;
    },
  });
  const { refetch } = query;
  const previous = useRef(realtime);
  useEffect(() => {
    const reconnected =
      previous.current !== RealtimeStatus.CONNECTED && realtime === RealtimeStatus.CONNECTED;
    previous.current = realtime;
    if (reconnected && id) void refetch();
  }, [id, realtime, refetch]);
  return query;
}
