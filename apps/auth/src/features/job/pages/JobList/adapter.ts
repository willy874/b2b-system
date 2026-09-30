import type { PlatformJobState } from '@/apis/platform-job/types';
import type { PlatformJob, PlatformJobQueue, PlatformJobSummary } from '@/shared/api-sdk';

import {
  JOB_NAME_LABEL_KEY,
  JOB_SCOPE_LABEL_KEY,
  JOB_STATE_DOT_CLASS,
  JOB_STATE_LABEL_KEY,
  PLATFORM_TENANT_FILTER,
} from '../../constants';

export interface JobQueueVM {
  name: string;
  /** 已知工作的顯示名稱；沒有就顯示 `name` 本身 */
  labelKey: string | undefined;
  scopeLabelKey: (typeof JOB_SCOPE_LABEL_KEY)[PlatformJobQueue['scope']];
  cron: string | null;
  readyCount: number;
  deferredCount: number;
  activeCount: number;
  failedCount: number;
  completedCount: number;
}

/**
 * 工作屬於誰：平台層級（`tenantId` 是 null），或某個租戶——
 * 租戶已刪除時後端查不到代碼，退回顯示 id。
 */
export type JobOwnerVM = { kind: 'platform' } | { kind: 'tenant'; label: string };

export interface JobRowVM {
  id: string;
  name: string;
  labelKey: string | undefined;
  owner: JobOwnerVM;
  /** `data-value` 用：租戶代碼（或 id），平台層級是 `platform` */
  ownerValue: string;
  state: PlatformJobState;
  stateLabelKey: (typeof JOB_STATE_LABEL_KEY)[PlatformJobState];
  stateDotClass: (typeof JOB_STATE_DOT_CLASS)[PlatformJobState];
  /** 已重試次數 / 上限 */
  retryCount: number;
  retryLimit: number;
  createdAt: Date;
  /** 排定在未來才執行（延後入列、重試退避中） */
  scheduledAt: Date | null;
  completedAt: Date | null;
  /** 只有 `failed` 且持有 `platformJob:retry` 才能重試 */
  canRetry: boolean;
}

export interface JobDetailVM {
  state: PlatformJobState;
  /** 失敗時的錯誤訊息（`output.message`）；成功或沒有訊息時是 `null` */
  errorMessage: string | null;
  data: Record<string, unknown>;
  output: Record<string, unknown> | null;
}

/** 已經結束、之後不會再變的狀態。 */
export function isFinalJobState(state: PlatformJobState): boolean {
  return state === 'completed' || state === 'cancelled' || state === 'failed';
}

export function toJobQueueVM(dto: PlatformJobQueue): JobQueueVM {
  return {
    name: dto.name,
    labelKey: JOB_NAME_LABEL_KEY[dto.name],
    scopeLabelKey: JOB_SCOPE_LABEL_KEY[dto.scope],
    cron: dto.cron,
    readyCount: dto.readyCount,
    deferredCount: dto.deferredCount,
    activeCount: dto.activeCount,
    failedCount: dto.failedCount,
    completedCount: dto.completedCount,
  };
}

function toOwner(dto: PlatformJobSummary): JobOwnerVM {
  if (dto.tenantId === null) return { kind: 'platform' };
  return { kind: 'tenant', label: dto.tenantCode ?? dto.tenantId };
}

/** adapter 是後端契約變動的緩衝層：欄位改名時只有這裡要改。 */
export function toJobRowVM(
  dto: PlatformJobSummary,
  capabilities: { canRetry: boolean },
  now: Date = new Date(),
): JobRowVM {
  const startAfter = new Date(dto.startAfter);
  const isWaiting = dto.state === 'created' || dto.state === 'retry';
  const owner = toOwner(dto);
  return {
    id: dto.id,
    name: dto.name,
    labelKey: JOB_NAME_LABEL_KEY[dto.name],
    owner,
    ownerValue: owner.kind === 'platform' ? PLATFORM_TENANT_FILTER : owner.label,
    state: dto.state,
    stateLabelKey: JOB_STATE_LABEL_KEY[dto.state],
    stateDotClass: JOB_STATE_DOT_CLASS[dto.state],
    retryCount: dto.retryCount,
    retryLimit: dto.retryLimit,
    createdAt: new Date(dto.createdOn),
    scheduledAt: isWaiting && startAfter > now ? startAfter : null,
    completedAt: dto.completedOn ? new Date(dto.completedOn) : null,
    canRetry: capabilities.canRetry && dto.state === 'failed',
  };
}

export function toJobDetailVM(dto: PlatformJob): JobDetailVM {
  const message = dto.state === 'failed' ? dto.output?.message : undefined;
  return {
    state: dto.state,
    errorMessage: typeof message === 'string' ? message : null,
    data: dto.data ?? {},
    output: dto.output,
  };
}
