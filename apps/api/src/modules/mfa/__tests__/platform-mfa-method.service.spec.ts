import { Logger } from '@nestjs/common';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { AuthUser } from '@/common/types';
import { AppException } from '@/core/errors';
import type { FeatureFlagGlobalState } from '@/core/feature-flags';
import type { MfaMethod, MfaMethodRegistry } from '@/core/mfa';

import { MFA_FACTOR_STATS_JOB, PlatformMfaMethodService } from '../platform-mfa-method.service';
import { method, registryOf } from './mfa.fixture';

const ACTOR: AuthUser = { id: 'admin-1', email: 'root@example.com', status: 'active' };

function setup(
  options: {
    registry?: MfaMethodRegistry;
    global?: Record<string, FeatureFlagGlobalState>;
    tenants?: { id: string }[];
    unconfigured?: string[];
  } = {},
) {
  const registry =
    options.registry ??
    registryOf(method('totp'), method('email', { defaultEnabled: false, challenge: 'server' }));
  const tx = { name: 'platform-tx' };
  const db = { transaction: vi.fn((fn: (t: unknown) => unknown) => fn(tx)) };
  const global = new Map(Object.entries(options.global ?? {}));
  const repo = {
    countTenantOverrides: vi.fn(
      async () => new Map<string, { on: number; off: number }>([['totp', { on: 1, off: 2 }]]),
    ),
    listStats: vi.fn(async () => [
      {
        method: 'totp',
        tenantFactors: 7,
        tenants: 2,
        platformFactors: 1,
        computedAt: new Date('2026-10-08T00:00:00.000Z'),
      },
    ]),
    setGlobal: vi.fn(async () => undefined),
    replaceStats: vi.fn(async () => undefined),
  };
  const overrides = {
    globalStateOf: vi.fn((id: string) => global.get(id)),
    changed: vi.fn(async () => undefined),
  };
  const availability = {
    platformAdminMethodIds: vi.fn(() => new Set(['totp'])),
    methodsFor: vi.fn(async () => registry.list('tenant')),
  };
  const audit = { record: vi.fn(async () => undefined) };
  const tenants = options.tenants ?? [{ id: 'tenant-a' }, { id: 'tenant-b' }];
  const directory = {
    findById: vi.fn(async (id: string) => tenants.find((tenant) => tenant.id === id)),
    listActive: vi.fn(async () => tenants),
  };
  const tenancy = { run: vi.fn((_id: string, fn: () => unknown) => fn()) };
  const tenantFactors = {
    countStranded: vi.fn(async () => 3),
    countActiveFactorsByMethod: vi.fn(async () => new Map([['totp', 4]])),
  };
  const platformFactors = {
    countActiveFactorsByMethod: vi.fn(async () => new Map([['email', 2]])),
  };
  const jobs = { register: vi.fn() };
  const config = { get: vi.fn(() => '0 3 * * *') };
  const settings = { summaryOf: vi.fn(() => null) };
  const settingsAccess = {
    isConfigured: vi.fn((m: MfaMethod) => !(options.unconfigured ?? []).includes(m.definition.id)),
  };
  const service = new PlatformMfaMethodService(
    db as never,
    registry,
    repo as never,
    overrides as never,
    availability as never,
    audit as never,
    directory as never,
    tenancy as never,
    tenantFactors as never,
    platformFactors as never,
    jobs as never,
    config as never,
    settings as never,
    settingsAccess as never,
  );
  return {
    service,
    tx,
    repo,
    overrides,
    availability,
    audit,
    directory,
    tenancy,
    tenantFactors,
    platformFactors,
    jobs,
    global,
  };
}

async function codeOf(promise: Promise<unknown>): Promise<string> {
  const error = await promise.then(
    () => undefined,
    (reason: unknown) => reason,
  );
  expect(error).toBeInstanceOf(AppException);
  return (error as AppException).code;
}

describe('PlatformMfaMethodService（docs/architecture/backend/21-mfa.md §5、D4）', () => {
  let warn: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('onModuleInit', () => {
    it('以 AUTH_TOKEN_CLEANUP_CRON 登記每日統計的工作，工作執行 computeStats', async () => {
      const { service, jobs, repo } = setup();
      service.onModuleInit();
      expect(jobs.register).toHaveBeenCalledWith(MFA_FACTOR_STATS_JOB, expect.any(Function), {
        cron: '0 3 * * *',
      });
      const handler = jobs.register.mock.calls[0]![1] as () => Promise<unknown>;
      await expect(handler()).resolves.toEqual({ tenants: 2, skipped: 0 });
      expect(repo.replaceStats).toHaveBeenCalled();
    });
  });

  describe('list', () => {
    it('列出每個方式的全平台狀態、生效值、租戶覆寫數、統計與平台管理者是否可用', async () => {
      const { service } = setup();
      const { items } = await service.list();
      expect(items).toEqual([
        {
          id: 'totp',
          challenge: 'none',
          enrollChallenge: 'immediate',
          enrollAt: 'anywhere',
          assurance: 'possession',
          maxFactorsPerAccount: 5,
          settings: null,
          realms: ['tenant', 'platform'],
          defaultEnabled: true,
          globalState: 'default',
          effective: true,
          tenantOverrides: { on: 1, off: 2 },
          stats: {
            tenantFactors: 7,
            tenants: 2,
            platformFactors: 1,
            computedAt: '2026-10-08T00:00:00.000Z',
          },
          platformAdminEnabled: true,
        },
        expect.objectContaining({
          id: 'email',
          defaultEnabled: false,
          globalState: 'default',
          effective: false,
          tenantOverrides: { on: 0, off: 0 },
          stats: null,
          platformAdminEnabled: false,
        }),
      ]);
    });

    it('全平台層的覆寫決定生效值：on 打開預設關閉的方式、off 關掉預設開啟的方式', async () => {
      const { service } = setup({ global: { totp: 'off', email: 'on' } });
      const { items } = await service.list();
      expect(items.map((item) => [item.id, item.globalState, item.effective])).toEqual([
        ['totp', 'off', false],
        ['email', 'on', true],
      ]);
    });
  });

  describe('update', () => {
    it('不在註冊表的方式 → MFA_METHOD_NOT_FOUND，不寫入', async () => {
      const { service, repo } = setup();
      expect(await codeOf(service.update('webauthn', { state: 'on' }, ACTOR))).toBe(
        'MFA_METHOD_NOT_FOUND',
      );
      expect(repo.setGlobal).not.toHaveBeenCalled();
    });

    it('需要平台參數而還沒填齊：開啟 → MFA_METHOD_NOT_CONFIGURED，不寫入；關閉、回到預設可以（§5.1）', async () => {
      const { service, repo } = setup({ unconfigured: ['email'] });
      expect(await codeOf(service.update('email', { state: 'on' }, ACTOR))).toBe(
        'MFA_METHOD_NOT_CONFIGURED',
      );
      expect(repo.setGlobal).not.toHaveBeenCalled();
      await service.update('email', { state: 'off' }, ACTOR);
      await service.update('email', { state: 'default' }, ACTOR);
      expect(repo.setGlobal).toHaveBeenCalledTimes(2);
    });

    it('在交易內寫入覆寫與稽核，之後通知其他程序並回傳更新後的方式', async () => {
      const { service, repo, audit, overrides, tx, global } = setup();
      overrides.changed.mockImplementation(async () => {
        global.set('totp', 'on');
      });
      const result = await service.update('totp', { state: 'on' }, ACTOR);
      expect(repo.setGlobal).toHaveBeenCalledWith('totp', 'on', ACTOR.id, tx);
      expect(audit.record).toHaveBeenCalledWith(
        {
          action: 'mfaMethod.update',
          resourceType: 'mfaMethod',
          resourceId: 'totp',
          actorId: ACTOR.id,
          actorEmail: ACTOR.email,
          metadata: { before: 'default', after: 'on' },
        },
        tx,
      );
      expect(overrides.changed).toHaveBeenCalledTimes(1);
      expect(result).toMatchObject({ id: 'totp', globalState: 'on', effective: true });
    });

    it('改回 default 時刪除覆寫（寫入 null）', async () => {
      const { service, repo, audit, tx } = setup({ global: { totp: 'off' } });
      await service.update('totp', { state: 'default' }, ACTOR);
      expect(repo.setGlobal).toHaveBeenCalledWith('totp', null, ACTOR.id, tx);
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({ metadata: { before: 'off', after: 'default' } }),
        tx,
      );
    });

    it('關閉方式的稽核標 severity: high', async () => {
      const { service, audit, tx } = setup();
      await service.update('totp', { state: 'off' }, ACTOR);
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({
          metadata: { before: 'default', after: 'off', severity: 'high' },
        }),
        tx,
      );
    });

    it('更新後在列表裡找不到這個方式 → MFA_METHOD_NOT_FOUND', async () => {
      const totp = method('totp');
      const registry = {
        get: vi.fn(() => totp),
        list: vi.fn(() => []),
      } as unknown as MfaMethodRegistry;
      const { service, repo } = setup({ registry });
      expect(await codeOf(service.update('totp', { state: 'on' }, ACTOR))).toBe(
        'MFA_METHOD_NOT_FOUND',
      );
      expect(repo.setGlobal).toHaveBeenCalled();
    });
  });

  describe('impact', () => {
    it('不在註冊表的方式 → MFA_METHOD_NOT_FOUND', async () => {
      const { service } = setup();
      expect(await codeOf(service.impact('webauthn'))).toBe('MFA_METHOD_NOT_FOUND');
    });

    it('指定的租戶不存在 → TENANT_NOT_FOUND', async () => {
      const { service } = setup();
      expect(await codeOf(service.impact('totp', 'missing'))).toBe('TENANT_NOT_FOUND');
    });

    it('指定租戶時只在那個租戶裡算，剩下的方式不含被關掉的那個', async () => {
      const { service, tenancy, tenantFactors, directory } = setup();
      const result = await service.impact('totp', 'tenant-b');
      expect(result).toEqual({ stranded: 3, tenants: 1, skippedTenants: 0 });
      expect(directory.listActive).not.toHaveBeenCalled();
      expect(tenancy.run).toHaveBeenCalledTimes(1);
      expect(tenancy.run).toHaveBeenCalledWith('tenant-b', expect.any(Function));
      expect(tenantFactors.countStranded).toHaveBeenCalledWith(['email']);
    });

    it('沒指定租戶時加總所有 active 的租戶；進不去的租戶略過並計數', async () => {
      const { service, tenancy, tenantFactors } = setup({
        tenants: [{ id: 'tenant-a' }, { id: 'tenant-b' }, { id: 'tenant-c' }],
      });
      tenancy.run.mockImplementation((id: string, fn: () => unknown) => {
        if (id === 'tenant-b') throw new Error('database unavailable');
        return fn();
      });
      tenantFactors.countStranded.mockResolvedValueOnce(2).mockResolvedValueOnce(5);
      const result = await service.impact('email');
      expect(result).toEqual({ stranded: 7, tenants: 2, skippedTenants: 1 });
      expect(warn).toHaveBeenCalledWith(
        expect.objectContaining({ tenantId: 'tenant-b' }),
        expect.any(String),
      );
      expect(tenantFactors.countStranded).toHaveBeenCalledWith(['totp']);
    });
  });

  describe('computeStats', () => {
    it('加總各租戶各方式的因子數與租戶數，合併平台管理者的，取代既有的統計', async () => {
      const { service, tenantFactors, repo } = setup({
        tenants: [{ id: 'tenant-a' }, { id: 'tenant-b' }],
      });
      tenantFactors.countActiveFactorsByMethod
        .mockResolvedValueOnce(new Map([['totp', 4]]))
        .mockResolvedValueOnce(
          new Map([
            ['totp', 1],
            ['email', 6],
          ]),
        );
      const result = await service.computeStats();
      expect(result).toEqual({ tenants: 2, skipped: 0 });
      expect(repo.replaceStats).toHaveBeenCalledWith([
        { method: 'totp', tenantFactors: 5, tenants: 2, platformFactors: 0 },
        { method: 'email', tenantFactors: 6, tenants: 1, platformFactors: 2 },
      ]);
    });

    it('只有平台管理者設定的方式，租戶的數字為 0；進不去的租戶略過', async () => {
      const { service, tenancy, platformFactors, repo } = setup({
        tenants: [{ id: 'tenant-a' }],
      });
      tenancy.run.mockRejectedValue(new Error('database unavailable'));
      platformFactors.countActiveFactorsByMethod.mockResolvedValue(new Map([['totp', 3]]));
      const result = await service.computeStats();
      expect(result).toEqual({ tenants: 0, skipped: 1 });
      expect(warn).toHaveBeenCalledTimes(1);
      expect(repo.replaceStats).toHaveBeenCalledWith([
        { method: 'totp', tenantFactors: 0, tenants: 0, platformFactors: 3 },
      ]);
    });
  });
});
