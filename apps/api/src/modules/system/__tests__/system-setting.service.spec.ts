import type { ConfigService } from '@nestjs/config';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import type { AuthUser } from '@/common/types';
import { BroadcastHub } from '@/core/broadcast/__tests__/broadcast-hub';
import type { Env } from '@/core/config';
import type { Database } from '@/core/database';
import { AppException } from '@/core/errors';
import type { DomainEventBus } from '@/core/events';
import { defineSetting, SettingCategory, SettingService } from '@/core/settings';
import { runInTenantContext } from '@/core/tenant';
import type { TenantContext, TenantFeature } from '@/core/tenant';
import type { AuditService } from '@/modules/audit-log/audit.service';

import { SystemSettingService } from '../system-setting.service';

const MAX_ATTEMPTS = defineSetting({
  key: 'auth.loginMaxAttempts',
  category: SettingCategory.AUTH,
  schema: z.number().int().min(3).max(20),
  defaultValue: 5,
  isPublic: false,
});

const REGISTRATION = defineSetting({
  key: 'auth.registrationEnabled',
  category: SettingCategory.AUTH,
  schema: z.boolean(),
  defaultValue: true,
  isPublic: true,
});

const TRASH_DAYS = defineSetting({
  key: 'trash.retentionDays',
  category: SettingCategory.TRASH,
  feature: 'trash',
  schema: z.number().int().min(1).max(365),
  defaultValue: 30,
  isPublic: false,
});

function inTenant<T>(features: readonly TenantFeature[], fn: () => T): T {
  return runInTenantContext({ id: 't1', features } as unknown as TenantContext, fn);
}

const ACTOR = { id: 'admin-1', email: 'admin@example.com' } as AuthUser;

function setup(
  rows: Array<{ key: string; value: unknown }> = [],
  extra: Array<typeof TRASH_DAYS> = [],
) {
  const repo = {
    listAll: vi.fn(async () =>
      rows.map((row) => ({ ...row, updatedAt: new Date('2026-09-30T00:00:00Z'), updatedBy: null })),
    ),
    upsert: vi.fn(async () => undefined),
    remove: vi.fn(async () => undefined),
  };
  const settings = new SettingService(
    repo as never,
    { get: vi.fn() } as unknown as ConfigService<Env, true>,
    new BroadcastHub().instance(),
  );
  settings.register([MAX_ATTEMPTS, REGISTRATION, ...extra]);
  const audit = { record: vi.fn(async () => undefined) };
  const events = { publish: vi.fn() };
  // withTransaction(db, fn) 只呼叫 db.transaction(fn)
  const db = { transaction: vi.fn(async (fn: (tx: unknown) => unknown) => fn('tx')) };
  const service = new SystemSettingService(
    db as unknown as Database,
    settings,
    audit as unknown as AuditService,
    events as unknown as DomainEventBus,
  );
  return { service, repo, audit, events };
}

async function errorOf(promise: Promise<unknown>): Promise<AppException> {
  const error = await promise.then(
    () => undefined,
    (reason: unknown) => reason,
  );
  expect(error).toBeInstanceOf(AppException);
  return error as AppException;
}

describe('SystemSettingService（docs/architecture/backend/12-settings.md §4）', () => {
  it('列表帶出生效值、預設值、是否覆寫與數值範圍', async () => {
    const { service } = setup([{ key: 'auth.loginMaxAttempts', value: 8 }]);
    const { items } = await service.list();
    expect(items).toEqual([
      expect.objectContaining({
        key: 'auth.loginMaxAttempts',
        type: 'number',
        value: 8,
        defaultValue: 5,
        isOverridden: true,
        minimum: 3,
        maximum: 20,
        updatedAt: '2026-09-30T00:00:00.000Z',
      }),
      expect.objectContaining({
        key: 'auth.registrationEnabled',
        type: 'boolean',
        value: true,
        isOverridden: false,
        minimum: null,
        maximum: null,
        updatedAt: null,
      }),
    ]);
  });

  it('平台未開放的 feature 的設定不列，也不能修改（docs/architecture/05-tenancy.md §15.2 D2）', async () => {
    const { service, repo } = setup([], [TRASH_DAYS]);
    const keysWith = async (features: TenantFeature[]) =>
      (await inTenant(features, () => service.list())).items.map((item) => item.key);
    await expect(keysWith(['trash'])).resolves.toContain('trash.retentionDays');
    await expect(keysWith([])).resolves.not.toContain('trash.retentionDays');

    const error = await errorOf(
      inTenant([], () => service.update({ values: { 'trash.retentionDays': 7 } }, ACTOR)),
    );
    expect(error.code).toBe('SETTING_NOT_FOUND');
    expect(repo.upsert).not.toHaveBeenCalled();
  });

  it('公開設定只包含標為公開的 key', async () => {
    const { service } = setup();
    await expect(service.listPublic()).resolves.toEqual({
      values: { 'auth.registrationEnabled': true },
    });
  });

  it('修改：寫入覆寫值、交易內寫一筆稽核、交易後推播', async () => {
    const { service, repo, audit, events } = setup();
    await service.update({ values: { 'auth.loginMaxAttempts': 10 } }, ACTOR);

    expect(repo.upsert).toHaveBeenCalledWith('auth.loginMaxAttempts', 10, 'admin-1', 'tx');
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'setting.update',
        resourceType: 'setting',
        changes: {
          before: { 'auth.loginMaxAttempts': 5 },
          after: { 'auth.loginMaxAttempts': 10 },
        },
      }),
      'tx',
    );
    expect(events.publish).toHaveBeenCalledWith('resource.changed', {
      changes: [{ resource: 'setting', kind: 'update', id: 'auth.loginMaxAttempts' }],
    });
  });

  it('值為 null → 刪掉覆寫值（還原預設）', async () => {
    const { service, repo, audit } = setup([{ key: 'auth.loginMaxAttempts', value: 8 }]);
    await service.update({ values: { 'auth.loginMaxAttempts': null } }, ACTOR);
    expect(repo.remove).toHaveBeenCalledWith('auth.loginMaxAttempts', 'tx');
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        changes: {
          before: { 'auth.loginMaxAttempts': 8 },
          after: { 'auth.loginMaxAttempts': 5 },
        },
      }),
      'tx',
    );
  });

  it('與生效值相同（含還原一個沒有覆寫的 key）→ 不寫、不稽核、不推播', async () => {
    const { service, repo, audit, events } = setup();
    await service.update(
      { values: { 'auth.loginMaxAttempts': 5, 'auth.registrationEnabled': null } },
      ACTOR,
    );
    expect(repo.upsert).not.toHaveBeenCalled();
    expect(repo.remove).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
    expect(events.publish).not.toHaveBeenCalled();
  });

  it('沒有登記的 key → SETTING_NOT_FOUND，其他 key 也不寫', async () => {
    const { service, repo } = setup();
    const error = await errorOf(
      service.update({ values: { 'auth.loginMaxAttempts': 10, 'auth.nope': 1 } }, ACTOR),
    );
    expect(error.code).toBe('SETTING_NOT_FOUND');
    expect(error.details).toEqual({ key: 'auth.nope' });
    expect(repo.upsert).not.toHaveBeenCalled();
  });

  it('超出範圍或型別不對 → VALIDATION_FAILED，fields 以 values.<key> 指出欄位', async () => {
    const { service, repo } = setup();
    for (const value of [0, 21, 3.5, 'five']) {
      const error = await errorOf(
        service.update({ values: { 'auth.loginMaxAttempts': value } }, ACTOR),
      );
      expect(error.code).toBe('VALIDATION_FAILED');
      expect(error.details).toEqual({
        fields: { 'values.auth.loginMaxAttempts': expect.any(String) },
      });
    }
    expect(repo.upsert).not.toHaveBeenCalled();
  });
});
