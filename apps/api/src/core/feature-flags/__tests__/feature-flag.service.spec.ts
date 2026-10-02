import type { ConfigService } from '@nestjs/config';
import { describe, expect, it, vi } from 'vitest';

import type { Env } from '@/core/config';
import type { Database } from '@/core/database';
import { runInTenantContext } from '@/core/tenant';
import type { TenantContext } from '@/core/tenant';

import type { FeatureFlagRepository } from '../feature-flag.repository';
import { FeatureFlagService } from '../feature-flag.service';
import type { FeatureFlagDefinition } from '../feature-flags';

const CATALOG: FeatureFlagDefinition[] = [
  {
    key: 'levelEditor.v2',
    description: '',
    defaultEnabled: false,
    owner: 't',
    removeBy: '2099-01-01',
  },
  {
    key: 'user.bulkInvite',
    description: '',
    defaultEnabled: true,
    owner: 't',
    removeBy: '2099-01-01',
  },
];

const config = {
  get: () => 0, // TENANT_CACHE_TTL = 0：不開定時重載
} as unknown as ConfigService<Env, true>;

function setup(rows: Array<{ key: string; state: string }> = [], catalog = CATALOG) {
  const repo = { listGlobal: vi.fn(async () => rows) };
  const service = new FeatureFlagService(catalog, repo as unknown as FeatureFlagRepository, config);
  return { service, repo };
}

function tenantWith(flags: Record<string, boolean>): TenantContext {
  return {
    id: 't1',
    code: 't1',
    db: {} as Database,
    storageBucket: 'b2b-t1',
    features: [],
    flags,
    featureParams: {},
  };
}

describe('FeatureFlagService（docs/adr/0022-feature-flags.md D3、D4）', () => {
  it('目錄有錯 → 啟動失敗', () => {
    expect(() => setup([], [{ ...CATALOG[0]!, key: 'bad' }, CATALOG[0]!])).toThrow(
      /feature flag 的目錄有錯/,
    );
  });

  it('沒有覆寫 → 預設值', async () => {
    const { service } = setup();
    await service.onApplicationBootstrap();
    expect(service.isEnabled('levelEditor.v2')).toBe(false);
    expect(service.isEnabled('user.bulkInvite')).toBe(true);
  });

  it('租戶脈絡內算上租戶層；脈絡外只看全平台層與預設值', async () => {
    const { service } = setup([{ key: 'levelEditor.v2', state: 'on' }]);
    await service.onApplicationBootstrap();

    expect(service.isEnabled('levelEditor.v2')).toBe(true);
    runInTenantContext(tenantWith({ 'levelEditor.v2': false }), () => {
      expect(service.isEnabled('levelEditor.v2')).toBe(false);
    });
  });

  it('全平台 off 蓋過租戶層', async () => {
    const { service } = setup([{ key: 'levelEditor.v2', state: 'off' }]);
    await service.onApplicationBootstrap();
    runInTenantContext(tenantWith({ 'levelEditor.v2': true }), () => {
      expect(service.isEnabled('levelEditor.v2')).toBe(false);
    });
  });

  it('不在目錄裡的 key 一律關，即使 DB 有覆寫', async () => {
    const { service } = setup([{ key: 'gone.flag', state: 'on' }]);
    await service.onApplicationBootstrap();
    runInTenantContext(tenantWith({ 'gone.flag': true }), () => {
      expect(service.isEnabled('gone.flag')).toBe(false);
    });
  });

  it('enabledKeys 依目錄的順序列出生效為開的 key', async () => {
    const { service } = setup([{ key: 'levelEditor.v2', state: 'on' }]);
    await service.onApplicationBootstrap();
    expect(service.enabledKeys()).toEqual(['levelEditor.v2', 'user.bulkInvite']);
    runInTenantContext(tenantWith({ 'user.bulkInvite': false }), () => {
      expect(service.enabledKeys()).toEqual(['levelEditor.v2']);
    });
  });

  it('reload 讀到新的全平台覆寫；讀取失敗時沿用上一份', async () => {
    const { service, repo } = setup([{ key: 'levelEditor.v2', state: 'on' }]);
    await service.onApplicationBootstrap();
    expect(service.globalStateOf('levelEditor.v2')).toBe('on');

    repo.listGlobal.mockRejectedValueOnce(new Error('db down'));
    await service.reload();
    expect(service.globalStateOf('levelEditor.v2')).toBe('on');

    repo.listGlobal.mockResolvedValueOnce([]);
    await service.reload();
    expect(service.globalStateOf('levelEditor.v2')).toBeUndefined();
  });
});
