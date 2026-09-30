import type { PlatformJobSummary } from '@/shared/api-sdk';

export type PlatformJobState = PlatformJobSummary['state'];

export interface PlatformJobListParams {
  offset: number;
  limit: number;
  /** 佇列（工作名稱），例：`tenant.provision` */
  name?: string;
  state?: PlatformJobState;
  /** 租戶代碼；字面量 `platform` 只看平台層級的工作；省略 = 全部 */
  tenant?: string;
}
