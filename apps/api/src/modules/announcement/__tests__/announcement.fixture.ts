import { expect, vi } from 'vitest';

import type { AuthUser } from '@/common/types';
import { AppException } from '@/core/errors';
import type { JobQueue } from '@/core/jobs';
import { DEFAULT_TIMEZONE_SETTING } from '@/core/settings';
import type { SettingService } from '@/core/settings';
import { runInTenantContext } from '@/core/tenant';
import type { TenantContext, TenantFeature } from '@/core/tenant';
import type {
  AnnouncementAudienceValue,
  AnnouncementDispatchRow,
  AnnouncementRow,
} from '@/db/schema';

import { AnnouncementTriggerCatalog } from '../announcement-trigger.catalog';
import type { AnnouncementWithPeople, DispatchWithPeople } from '../announcement.repository';
import { AnnouncementScheduler } from '../announcement.scheduler';
import {
  ANNOUNCEMENT_DISPATCH_RETENTION_DAYS_SETTING,
  ANNOUNCEMENT_MAX_RECIPIENTS_SETTING,
} from '../announcement.settings';
import { defineAnnouncementTrigger } from '../announcement.triggers';

/** 測試的「現在」（以 `vi.setSystemTime` 固定）。 */
export const NOW = new Date('2026-10-06T00:00:00.000Z');
export const TAIPEI = 'Asia/Taipei';

export const ACTOR: AuthUser = { id: 'actor-1', email: 'actor@example.com', status: 'active' };
export const PERSON = { id: ACTOR.id, displayName: 'Actor' };

export const AUDIENCE: AnnouncementAudienceValue = {
  all: false,
  userIds: ['user-1'],
  groupIds: ['group-1'],
  roleIds: ['role-1'],
};

export const USER_ACTIVATED = defineAnnouncementTrigger('user.activated', { scope: 'audience' });
export const GROUP_MEMBER_ADDED = defineAnnouncementTrigger('group.memberAdded', {
  scope: 'group',
});
export const USER_ROLE_ASSIGNED = defineAnnouncementTrigger('user.roleAssigned', {
  scope: 'role',
});
/** 屬於可關閉的 feature 的觸發點：feature 沒啟用時不列出、不觸發。 */
export const FILE_UPLOADED = defineAnnouncementTrigger('file.uploaded', {
  scope: 'audience',
  feature: 'file',
});

export function catalog(): AnnouncementTriggerCatalog {
  const result = new AnnouncementTriggerCatalog();
  result.register([USER_ACTIVATED, GROUP_MEMBER_ADDED, USER_ROLE_ASSIGNED, FILE_UPLOADED]);
  return result;
}

export function announcement(overrides: Partial<AnnouncementRow> = {}): AnnouncementRow {
  return {
    id: 'ann-1',
    title: '季度說明會',
    body: '十月的季度說明會改到線上舉行。',
    // 還沒有 body_doc 的列（部署期間舊版 api 寫入的）：讀取時以 body 轉換
    bodyDoc: null,
    audience: AUDIENCE,
    trigger: { kind: 'immediate' },
    status: 'draft',
    nextRunAt: null,
    version: 3,
    createdAt: new Date('2026-10-01T00:00:00.000Z'),
    createdBy: ACTOR.id,
    updatedAt: new Date('2026-10-02T00:00:00.000Z'),
    updatedBy: 'editor-1',
    deletedAt: null,
    ...overrides,
  };
}

export function withPeople(row: AnnouncementRow): AnnouncementWithPeople {
  return { ...row, creator: PERSON, updater: PERSON };
}

export function dispatchRow(
  overrides: Partial<AnnouncementDispatchRow> = {},
): AnnouncementDispatchRow {
  return {
    id: 'disp-1',
    announcementId: 'ann-1',
    scheduledFor: new Date('2026-10-05T01:00:00.000Z'),
    title: '季度說明會',
    body: '十月的季度說明會改到線上舉行。',
    bodyDoc: null,
    audience: AUDIENCE,
    status: 'pending',
    triggerSubjectId: null,
    recipientCount: null,
    details: null,
    createdBy: ACTOR.id,
    createdAt: new Date('2026-10-05T01:00:00.000Z'),
    startedAt: null,
    finishedAt: null,
    revokedAt: null,
    revokedBy: null,
    ...overrides,
  };
}

export function dispatchWithPeople(
  overrides: Partial<AnnouncementDispatchRow> = {},
): DispatchWithPeople {
  return { ...dispatchRow(overrides), creator: PERSON, revoker: null };
}

/**
 * 假的交易：`log` 依序記下 begin／commit 與各個副作用，用來驗證「稽核在交易內、事件在提交後」。
 * `fn` 拋錯時沒有 commit。
 */
export function fakeDatabase(log: string[]) {
  const tx = { name: 'tx' };
  const db = {
    transaction: vi.fn(async (fn: (t: unknown) => Promise<unknown>) => {
      log.push('begin');
      const result = await fn(tx);
      log.push('commit');
      return result;
    }),
  };
  return { db, tx };
}

export interface SettingValues {
  timeZone?: string;
  maxRecipients?: number;
  retentionDays?: number;
}

export function fakeSettings(values: SettingValues = {}) {
  const byKey: Record<string, unknown> = {
    [DEFAULT_TIMEZONE_SETTING.key]: values.timeZone ?? TAIPEI,
    [ANNOUNCEMENT_MAX_RECIPIENTS_SETTING.key]: values.maxRecipients ?? 10_000,
    [ANNOUNCEMENT_DISPATCH_RETENTION_DAYS_SETTING.key]: values.retentionDays ?? 365,
  };
  return { get: vi.fn(async (definition: { key: string }) => byKey[definition.key]) };
}

export function fakeJobs(log: string[] = []) {
  return {
    enqueue: vi.fn(async (type: { name: string }, _data: object, _options?: object) => {
      log.push(`enqueue:${type.name}`);
      return 'job-1';
    }),
  };
}

/** 真的排程器（規則只有一份），設定與佇列是假的。 */
export function scheduler(
  settings: ReturnType<typeof fakeSettings>,
  jobs: ReturnType<typeof fakeJobs>,
): AnnouncementScheduler {
  return new AnnouncementScheduler(
    settings as unknown as SettingService,
    jobs as unknown as JobQueue,
  );
}

export function inTenant<T>(
  fn: () => Promise<T>,
  features: TenantFeature[] = ['announcement', 'file'],
): Promise<T> {
  return runInTenantContext(
    { id: 't1', code: 'acme', features, featureParams: {} } as unknown as TenantContext,
    fn,
  );
}

export async function expectCode(promise: Promise<unknown>, code: string, details?: object) {
  const error = await promise.then(
    () => undefined,
    (reason: unknown) => reason,
  );
  expect(error).toBeInstanceOf(AppException);
  expect((error as AppException).code).toBe(code);
  if (details) expect((error as AppException).details).toEqual(details);
}
