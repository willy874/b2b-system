import type { ConfigService } from '@nestjs/config';
import { describe, expect, it, vi } from 'vitest';

import type { AuthUser } from '@/common/types';
import type { Env } from '@/core/config';
import type { PlatformDatabase } from '@/core/database';
import { AppException } from '@/core/errors';
import type { JobStore } from '@/core/jobs';
import { resolveCdnEffective } from '@/core/storage';
import type { CdnPathResolver, CdnSettings, CdnStoredOverrides } from '@/core/storage';
import { cdnConfigOf } from '@/core/storage/__tests__/cdn.fixture';
import type { CdnCheckResult, CdnSettingsRow } from '@/db/platform/schema';
import type { PlatformAdminService } from '@/modules/platform-admin/platform-admin.service';
import type { PlatformAuditService } from '@/modules/platform-admin/platform-audit.service';

import type { CdnHealthService } from '../cdn-health.service';
import { newlyServed, PlatformCdnSettingsService } from '../platform-cdn-settings.service';
import type { PlatformCdnRepository } from '../platform-cdn.repository';

vi.mock('@/core/database', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/core/database')>()),
  // 交易直接把 db 當 tx 傳下去：repository 是假的
  withTransaction: async (db: unknown, fn: (tx: unknown) => Promise<unknown>) => fn(db),
}));

const ACTOR: AuthUser = { id: 'admin-1', email: 'ops@example.com', status: 'active' };

const READY: CdnCheckResult = {
  checkedAt: '2026-10-09T00:00:00Z',
  ready: true,
  discovery: { ok: true },
  nodes: [],
  publicUrl: { result: 'ok' },
  signatureEnforced: { result: 'ok' },
};
const NOT_READY: CdnCheckResult = {
  ...READY,
  ready: false,
  nodes: [
    {
      address: '10.0.0.2',
      problems: ['signingKidMissing'],
      kids: ['k1'],
      missingKids: ['k2'],
      cache: null,
      build: null,
      startedAt: null,
    },
  ],
};

function rowOf(values: Partial<CdnSettingsRow>): CdnSettingsRow {
  return {
    id: 'default',
    state: null,
    resources: null,
    urlTtlCap: null,
    purgeOnDelete: null,
    purgeBatchSize: null,
    stateChangedAt: null,
    stateChangedBy: null,
    lastCheckAt: null,
    lastCheck: null,
    version: 1,
    updatedBy: null,
    updatedAt: new Date('2026-10-09T00:00:00Z'),
    ...values,
  };
}

function setup({
  row,
  env = {},
  check = READY,
}: { row?: CdnSettingsRow; env?: Record<string, string>; check?: CdnCheckResult } = {}) {
  let current = row;
  const repo = {
    find: vi.fn(async () => current),
    save: vi.fn(async (values: Partial<CdnSettingsRow>, version: number) => {
      if ((current?.version ?? 1) !== version) return undefined;
      current = rowOf({ ...current, ...values, version: version + 1 });
      return current;
    }),
  };
  const settings = { changed: vi.fn(async () => undefined) };
  const health = { check: vi.fn(async () => check) };
  const audit = { record: vi.fn(async () => undefined) };
  const config = cdnConfigOf(env);
  const service = new PlatformCdnSettingsService(
    {} as PlatformDatabase,
    repo as unknown as PlatformCdnRepository,
    config,
    settings as unknown as CdnSettings,
    health as unknown as CdnHealthService,
    { registered: () => ['imageAsset', 'fileVariant'] } as unknown as CdnPathResolver,
    { list: async () => ({ items: [], total: 0 }) } as unknown as JobStore,
    { findById: async () => ({ email: 'ops@example.com' }) } as unknown as PlatformAdminService,
    audit as unknown as PlatformAuditService,
    { get: () => '*/5 * * * *' } as unknown as ConfigService<Env, true>,
  );
  return { service, repo, settings, health, audit };
}

async function errorOf(promise: Promise<unknown>): Promise<AppException> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof AppException) return error;
    throw error;
  }
  throw new Error('預期要拋出 AppException');
}

const LIMITS = cdnConfigOf().deploymentLimits;
const NONE: CdnStoredOverrides = {
  state: null,
  resources: null,
  urlTtlCap: null,
  purgeOnDelete: null,
  purgeBatchSize: null,
};

const effective = (stored: Partial<CdnStoredOverrides>) =>
  resolveCdnEffective(LIMITS, { ...NONE, ...stored });

describe('newlyServed：哪些變更要先通過節點檢查（§17 D14）', () => {
  it('由關到開 → 開放中的資源全部算新的', () => {
    expect(newlyServed(effective({ state: 'off' }), effective({ state: 'on' }))).toEqual([
      'fileVariant',
      'imageAsset',
      'galleryItem',
    ]);
  });

  it('開著時加入資源類型 → 只有加入的那一種', () => {
    expect(
      newlyServed(
        effective({ resources: ['fileVariant'] }),
        effective({ resources: ['fileVariant', 'imageAsset'] }),
      ),
    ).toEqual(['imageAsset']);
  });

  it('關閉、移除資源類型、調整效期 → 不需要檢查', () => {
    expect(newlyServed(effective({}), effective({ state: 'off' }))).toEqual([]);
    expect(newlyServed(effective({}), effective({ resources: ['fileVariant'] }))).toEqual([]);
    expect(newlyServed(effective({}), effective({ urlTtlCap: 600 }))).toEqual([]);
  });

  it('關著時加入資源類型 → 還沒有簽 CDN 網址，不需要檢查', () => {
    expect(
      newlyServed(
        effective({ state: 'off', resources: ['fileVariant'] }),
        effective({ state: 'off', resources: ['fileVariant', 'imageAsset'] }),
      ),
    ).toEqual([]);
  });
});

describe('PlatformCdnSettingsService.update（docs/architecture/backend/09-file.md §16.9）', () => {
  it('沒有列時第一次寫入（version 1）：關閉不檢查，寫稽核 high，交易後重讀並廣播', async () => {
    const { service, repo, settings, health, audit } = setup();
    const overview = await service.update({ version: 1, state: 'off' }, ACTOR);

    expect(health.check).not.toHaveBeenCalled();
    expect(repo.save).toHaveBeenCalledWith(
      expect.objectContaining({ state: 'off', stateChangedBy: 'admin-1', updatedBy: 'admin-1' }),
      1,
      expect.anything(),
    );
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'cdn.update',
        resourceType: 'cdn',
        metadata: { before: { state: null }, after: { state: 'off' }, severity: 'high' },
      }),
      expect.anything(),
    );
    expect(settings.changed).toHaveBeenCalled();
    expect(overview.settings?.version).toBe(2);
    expect(overview.effective?.serving).toBe(false);
    expect(overview.effective?.issuedUrlsExpireAt).not.toBeNull();
  });

  it('state 以外的欄位 → 稽核 normal，只記有變的欄位', async () => {
    const { service, audit } = setup();
    await service.update({ version: 1, urlTtlCap: 600, purgeOnDelete: true }, ACTOR);
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: {
          before: { urlTtlCap: null, purgeOnDelete: null },
          after: { urlTtlCap: 600, purgeOnDelete: true },
          severity: 'normal',
        },
      }),
      expect.anything(),
    );
  });

  it('由關到開：檢查通過才寫入', async () => {
    const { service, repo, health } = setup({ row: rowOf({ state: 'off', version: 3 }) });
    await service.update({ version: 3, state: 'on' }, ACTOR);
    expect(health.check).toHaveBeenCalled();
    expect(repo.save).toHaveBeenCalled();
  });

  it('由關到開但 kid 不一致 → 409 CDN_NOT_READY（details.nodes），不寫入', async () => {
    const { service, repo } = setup({ row: rowOf({ state: 'off', version: 3 }), check: NOT_READY });
    const error = await errorOf(service.update({ version: 3, state: 'on' }, ACTOR));
    expect(error.code).toBe('CDN_NOT_READY');
    expect(error.details?.nodes).toEqual([
      { address: '10.0.0.2', problems: ['signingKidMissing'] },
    ]);
    expect(repo.save).not.toHaveBeenCalled();
  });

  it('加入資源類型同樣要通過檢查', async () => {
    const { service } = setup({
      row: rowOf({ resources: ['fileVariant'], version: 2 }),
      check: NOT_READY,
    });
    const error = await errorOf(
      service.update({ version: 2, resources: ['fileVariant', 'imageAsset'] }, ACTOR),
    );
    expect(error.code).toBe('CDN_NOT_READY');
    expect(error.details?.resources).toEqual(['imageAsset']);
  });

  it('version 不符 → 409 CDN_SETTINGS_VERSION_CONFLICT（details.current）', async () => {
    const { service } = setup({ row: rowOf({ version: 4 }) });
    const error = await errorOf(service.update({ version: 3, state: 'off' }, ACTOR));
    expect(error.code).toBe('CDN_SETTINGS_VERSION_CONFLICT');
    expect(error.details).toEqual({ current: 4 });
  });

  it('沒有部署 CDN → 409 CDN_NOT_DEPLOYED', async () => {
    const { service } = setup({ env: { FILE_CDN_ENABLED: 'false' } });
    expect((await errorOf(service.update({ version: 1, state: 'off' }, ACTOR))).code).toBe(
      'CDN_NOT_DEPLOYED',
    );
  });

  it('超出部署的範圍 → VALIDATION_FAILED：沒開放的資源、效期超過上限或低於 300、沒有清理端點時開自動清理', async () => {
    const { service } = setup({
      env: {
        FILE_CDN_RESOURCES: 'fileVariant',
        FILE_CDN_MAX_URL_TTL: '3600',
        FILE_CDN_PURGE_ON_DELETE: 'false',
        FILE_CDN_PURGE_URL: '',
        FILE_CDN_PURGE_SECRET: '',
      },
    });
    const resources = await errorOf(
      service.update({ version: 1, resources: ['imageAsset'] }, ACTOR),
    );
    expect(resources.details?.fields).toEqual({ resources: 'CDN_RESOURCE_NOT_DEPLOYED' });
    const high = await errorOf(service.update({ version: 1, urlTtlCap: 7200 }, ACTOR));
    expect(high.details?.fields).toEqual({ urlTtlCap: 'CDN_URL_TTL_OUT_OF_RANGE' });
    const low = await errorOf(service.update({ version: 1, urlTtlCap: 60 }, ACTOR));
    expect(low.details).toMatchObject({ min: 300, max: 3600 });
    const purge = await errorOf(service.update({ version: 1, purgeOnDelete: true }, ACTOR));
    expect(purge.details?.fields).toEqual({ purgeOnDelete: 'CDN_PURGE_NOT_CONFIGURED' });
  });

  it('沒有變更 → 不寫入、不寫稽核、不廣播', async () => {
    const { service, repo, audit, settings } = setup({ row: rowOf({ state: 'off', version: 2 }) });
    await service.update({ version: 2, state: 'off' }, ACTOR);
    expect(repo.save).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
    expect(settings.changed).not.toHaveBeenCalled();
  });

  it('null → 回到跟著環境變數', async () => {
    const { service, repo } = setup({ row: rowOf({ urlTtlCap: 600, version: 2 }) });
    const overview = await service.update({ version: 2, urlTtlCap: null }, ACTOR);
    expect(repo.save).toHaveBeenCalledWith(
      expect.objectContaining({ urlTtlCap: null }),
      2,
      expect.anything(),
    );
    expect(overview.effective?.urlTtlCap).toBe(86_400);
  });
});

describe('PlatformCdnSettingsService.overview', () => {
  it('沒有部署 CDN → 只有部署資訊', async () => {
    const { service } = setup({ env: { FILE_CDN_ENABLED: 'false' } });
    const overview = await service.overview();
    expect(overview.deployment.deployed).toBe(false);
    expect(overview).toMatchObject({ settings: null, effective: null, lastCheck: null });
  });

  it('部署資訊：簽發中與可驗證的 kid、上限與預設值；存放值與生效值分開', async () => {
    const { service } = setup({
      env: { FILE_CDN_RESOURCES: 'fileVariant' },
      row: rowOf({ resources: ['fileVariant', 'imageAsset'], version: 2 }),
    });
    const overview = await service.overview();
    expect(overview.deployment).toMatchObject({
      deployed: true,
      signingKid: 'k2',
      kids: ['k2', 'k1'],
      resources: ['fileVariant'],
      minUrlTtl: 300,
      purgeConfigured: true,
      healthCheckCron: '*/5 * * * *',
    });
    expect(overview.settings?.resources).toEqual(['fileVariant', 'imageAsset']);
    expect(overview.effective).toMatchObject({
      resources: ['fileVariant'],
      clamped: { resources: ['imageAsset'], urlTtlCap: false },
    });
    expect(overview.purgeTargets).toEqual(['imageAsset', 'fileVariant']);
  });
});
