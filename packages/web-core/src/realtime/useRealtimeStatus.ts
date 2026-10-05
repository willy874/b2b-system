import { useSyncExternalStore } from 'react';

import {
  getActiveRealtimeClient,
  isRealtimeAvailable,
  subscribeRealtimeAvailability,
} from './activeClient';

export const RealtimeStatus = {
  /** 本分頁或 leader 分頁連線中，推播可用。 */
  CONNECTED: 'connected',
  /** 沒有連線（連線中、重連中或伺服器無法連線）；功能退回定期重抓。 */
  DISCONNECTED: 'disconnected',
  /** 沒有註冊推播（mock 模式）。 */
  DISABLED: 'disabled',
} as const;

export type RealtimeStatus = (typeof RealtimeStatus)[keyof typeof RealtimeStatus];

function getStatus(): RealtimeStatus {
  if (!getActiveRealtimeClient()) return RealtimeStatus.DISABLED;
  return isRealtimeAvailable() ? RealtimeStatus.CONNECTED : RealtimeStatus.DISCONNECTED;
}

/** 推播的連線狀態，跨分頁一致：follower 分頁看的是 leader 回報的狀態。 */
export function useRealtimeStatus(): RealtimeStatus {
  return useSyncExternalStore(subscribeRealtimeAvailability, getStatus);
}
