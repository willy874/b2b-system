import type { ConfigService } from '@nestjs/config';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Env } from '../../config';
import { AppException } from '../../errors';
import { SCHEMA_RECHECK_MS, Tenancy } from '../tenancy.service';
import type { TenantDirectory, TenantRecord } from '../tenant-directory.service';

const { applied } = vi.hoisted(() => ({ applied: vi.fn() }));

vi.mock('../tenant-schema', () => ({
  EXPECTED_TENANT_MIGRATION: 200,
  appliedTenantMigration: applied,
}));

function tenant(overrides: Partial<TenantRecord> = {}): TenantRecord {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    code: 'acme',
    name: 'Acme',
    status: 'active',
    databaseUrl: 'postgres://user:pass@127.0.0.1:1/acme',
    storageBucket: 'b2b-acme',
    features: ['file', 'auditLog', 'job'],
    flags: {},
    ...overrides,
  } as TenantRecord;
}

function setup(active: TenantRecord[] = [], byId: TenantRecord[] = active) {
  const directory = {
    listActive: vi.fn(async () => active),
    findById: vi.fn(async (id: string) => byId.find((record) => record.id === id)),
  } as unknown as TenantDirectory;
  const config = { get: vi.fn(() => 2) } as unknown as ConfigService<Env, true>;
  return new Tenancy(directory, config);
}

async function codeOf(promise: Promise<unknown>): Promise<string | undefined> {
  return (await errorOf(promise))?.code;
}

async function errorOf(
  promise: Promise<unknown>,
): Promise<{ code: string; reason?: unknown } | undefined> {
  try {
    await promise;
    return undefined;
  } catch (error) {
    return error instanceof AppException
      ? { code: error.code, reason: error.details?.reason }
      : { code: 'OTHER' };
  }
}

let tenancy: Tenancy;

beforeEach(() => {
  applied.mockReset();
});

afterEach(async () => {
  await tenancy.onApplicationShutdown();
  vi.useRealTimers();
});

describe('Tenancy：租戶的 migration 版本檢查（docs/adr/0020-physical-tenant-isolation.md D14）', () => {
  it('版本對上 → 進入；結果沿用，不再查 DB', async () => {
    tenancy = setup();
    applied.mockResolvedValue(200);
    const context = await tenancy.enter(tenant());
    expect(context).toMatchObject({
      code: 'acme',
      storageBucket: 'b2b-acme',
      features: ['file', 'auditLog', 'job'],
      flags: {},
    });
    await tenancy.enter(tenant());
    expect(applied).toHaveBeenCalledTimes(1);
  });

  it('DB 比程式新（滾動部署、程式回滾）照常進入', async () => {
    tenancy = setup();
    applied.mockResolvedValue(300);
    await expect(tenancy.enter(tenant())).resolves.toMatchObject({ code: 'acme' });
  });

  it('落後或從沒跑過 migration → TENANT_UNAVAILABLE', async () => {
    tenancy = setup();
    applied.mockResolvedValue(100);
    expect(await codeOf(tenancy.enter(tenant()))).toBe('TENANT_UNAVAILABLE');
    applied.mockResolvedValue(undefined);
    expect(await codeOf(tenancy.enter(tenant({ id: 'other', code: 'other' })))).toBe(
      'TENANT_UNAVAILABLE',
    );
  });

  it('落後的租戶在補跑 migration 後自動恢復（間隔 SCHEMA_RECHECK_MS 重新檢查）', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    tenancy = setup();
    applied.mockResolvedValue(100);
    expect(await codeOf(tenancy.enter(tenant()))).toBe('TENANT_UNAVAILABLE');

    applied.mockResolvedValue(200);
    expect(await codeOf(tenancy.enter(tenant()))).toBe('TENANT_UNAVAILABLE');
    expect(applied).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(SCHEMA_RECHECK_MS);
    await expect(tenancy.enter(tenant())).resolves.toMatchObject({ code: 'acme' });
    expect(applied).toHaveBeenCalledTimes(2);
  });

  it('檢查失敗（DB 連不上）→ TENANT_UNAVAILABLE，下一次立刻重試', async () => {
    tenancy = setup();
    applied.mockRejectedValueOnce(new Error('connect ECONNREFUSED'));
    expect(await codeOf(tenancy.enter(tenant()))).toBe('TENANT_UNAVAILABLE');
    applied.mockResolvedValue(200);
    await expect(tenancy.enter(tenant())).resolves.toMatchObject({ code: 'acme' });
  });

  it('換了連線字串 → 重新檢查', async () => {
    tenancy = setup();
    applied.mockResolvedValue(200);
    await tenancy.enter(tenant());
    applied.mockResolvedValue(100);
    const moved = tenant({ databaseUrl: 'postgres://user:pass@127.0.0.1:1/acme_new' });
    expect(await codeOf(tenancy.enter(moved))).toBe('TENANT_UNAVAILABLE');
  });

  it('併發的第一次進入共用同一次檢查', async () => {
    tenancy = setup();
    applied.mockResolvedValue(200);
    await Promise.all([tenancy.enter(tenant()), tenancy.enter(tenant()), tenancy.enter(tenant())]);
    expect(applied).toHaveBeenCalledTimes(1);
  });

  it('停用的租戶不檢查版本，直接 TENANT_UNAVAILABLE', async () => {
    tenancy = setup();
    expect(await codeOf(tenancy.enter(tenant({ status: 'disabled' })))).toBe('TENANT_UNAVAILABLE');
    expect(applied).not.toHaveBeenCalled();
  });

  it('啟動時檢查每個 active 租戶，落後的不阻止啟動；之後進入沿用啟動時的結果', async () => {
    const current = tenant();
    const behind = tenant({ id: 'behind', code: 'behind', databaseUrl: 'postgres://x@h:1/b' });
    tenancy = setup([current, behind]);
    applied.mockImplementation(async () => (applied.mock.calls.length === 1 ? 200 : 100));
    await expect(tenancy.onApplicationBootstrap()).resolves.toBeUndefined();
    expect(applied).toHaveBeenCalledTimes(2);

    await tenancy.enter(current);
    expect(await codeOf(tenancy.enter(behind))).toBe('TENANT_UNAVAILABLE');
    expect(applied).toHaveBeenCalledTimes(2);
  });

  it('forEachActive 跳過落後的租戶並回報', async () => {
    const current = tenant();
    const behind = tenant({ id: 'behind', code: 'behind', databaseUrl: 'postgres://x@h:1/b' });
    tenancy = setup([current, behind]);
    applied.mockImplementation(async () => (applied.mock.calls.length === 1 ? 200 : 100));
    const visited: string[] = [];
    const failed = await tenancy.forEachActive(async (context) => {
      visited.push(context.code);
    });
    expect(visited).toEqual(['acme']);
    expect(failed).toEqual(['behind']);
  });

  it('TENANT_UNAVAILABLE 帶原因：停用是 inactive（重試沒用），落後是 maintenance（暫時的）', async () => {
    tenancy = setup();
    expect(await errorOf(tenancy.enter(tenant({ status: 'disabled' })))).toEqual({
      code: 'TENANT_UNAVAILABLE',
      reason: 'inactive',
    });
    applied.mockResolvedValue(100);
    expect(await errorOf(tenancy.enter(tenant()))).toEqual({
      code: 'TENANT_UNAVAILABLE',
      reason: 'maintenance',
    });
  });

  it('runForMaintenance：停用的租戶也能進入（停用之後撤銷 session 用），仍檢查版本', async () => {
    const disabled = tenant({ status: 'disabled' });
    tenancy = setup([], [disabled]);
    applied.mockResolvedValue(200);
    await expect(tenancy.runForMaintenance(disabled.id, async () => 'ok')).resolves.toBe('ok');
    expect(await codeOf(tenancy.run(disabled.id, async () => 'ok'))).toBe('TENANT_UNAVAILABLE');
    expect(await codeOf(tenancy.runForMaintenance('missing', async () => 'ok'))).toBe(
      'TENANT_NOT_FOUND',
    );
  });

  it('evict：丟掉連線池與版本檢查的結果，下次進入重新檢查', async () => {
    tenancy = setup();
    applied.mockResolvedValue(200);
    await tenancy.enter(tenant());
    await tenancy.evict(tenant().id);
    await tenancy.enter(tenant());
    expect(applied).toHaveBeenCalledTimes(2);
  });
});
