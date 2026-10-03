import { describe, expect, it, vi } from 'vitest';

import type { AuthUser } from '@/common/types';
import { DomainEvent } from '@/core/events';
import type { DomainEventBus } from '@/core/events';
import type { FeatureFlagDefinition, FeatureFlagService } from '@/core/feature-flags';
import type { TenantDirectory } from '@/core/tenant';
import type { PlatformAuditService } from '@/modules/platform-admin/platform-audit.service';

import type { PlatformFeatureFlagRepository } from '../platform-feature-flag.repository';
import { PlatformFeatureFlagService } from '../platform-feature-flag.service';

const CATALOG: FeatureFlagDefinition[] = [
  {
    key: 'levelEditor.v2',
    description: '新版關卡編輯器',
    defaultEnabled: false,
    owner: 'content',
    removeBy: '2099-01-01',
  },
];
const ACTOR = { id: 'admin-1', email: 'ops@example.com' } as AuthUser;

/** 依呼叫順序記下副作用，驗證「交易（含稽核）→ 重新載入 → 推播」的先後（CLAUDE.md 後端規則 6）。 */
function setup(initial?: 'on' | 'off') {
  const calls: string[] = [];
  let global = initial;
  const repo = {
    transaction: vi.fn(async (fn: (tx: unknown) => unknown) => {
      calls.push('transaction');
      return fn('tx');
    }),
    findGlobalForUpdate: vi.fn(async () => global),
    setGlobal: vi.fn(async (_key: string, state: 'on' | 'off') => {
      global = state;
    }),
    clearGlobal: vi.fn(async () => {
      global = undefined;
    }),
    countTenantOverrides: vi.fn(async () => [
      { key: 'levelEditor.v2', enabled: true, count: 2 },
      { key: 'gone.flag', enabled: true, count: 5 },
    ]),
  };
  const flags = {
    catalog: CATALOG,
    has: (key: string) => CATALOG.some((flag) => flag.key === key),
    globalStateOf: () => global,
    reload: vi.fn(async () => {
      calls.push('reload');
    }),
  };
  const directory = { listActive: vi.fn(async () => [{ id: 't1' }, { id: 't2' }]) };
  const events = { publish: vi.fn(() => calls.push('publish')) };
  const audit = {
    record: vi.fn(async () => {
      calls.push('audit');
    }),
  };
  const service = new PlatformFeatureFlagService(
    repo as unknown as PlatformFeatureFlagRepository,
    flags as unknown as FeatureFlagService,
    directory as unknown as TenantDirectory,
    events as unknown as DomainEventBus,
    audit as unknown as PlatformAuditService,
  );
  return { service, repo, flags, events, audit, calls };
}

describe('PlatformFeatureFlagService（docs/architecture/05-tenancy.md §11.2 D7、D8）', () => {
  it('list：目錄、全平台覆寫、覆寫它的租戶數；不在目錄裡的 key 不出現', async () => {
    const { service, flags } = setup('on');

    const result = await service.list();

    expect(flags.reload).toHaveBeenCalled();
    expect(result.items).toEqual([
      {
        key: 'levelEditor.v2',
        description: '新版關卡編輯器',
        defaultEnabled: false,
        owner: 'content',
        removeBy: '2099-01-01',
        globalState: 'on',
        tenantOverrides: { on: 2, off: 0 },
      },
    ]);
  });

  it('緊急關閉：交易內寫入與稽核，重新載入後對每個 active 租戶發佈', async () => {
    const { service, repo, audit, events, calls } = setup();

    const result = await service.update('levelEditor.v2', { state: 'off' }, ACTOR);

    expect(repo.setGlobal).toHaveBeenCalledWith('levelEditor.v2', 'off', 'admin-1', 'tx');
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'featureFlag.update',
        resourceType: 'featureFlag',
        metadata: { key: 'levelEditor.v2', before: 'default', after: 'off' },
      }),
      'tx',
    );
    expect(events.publish.mock.calls).toEqual([
      [DomainEvent.TENANT_FEATURES_CHANGED, { tenantId: 't1' }],
      [DomainEvent.TENANT_FEATURES_CHANGED, { tenantId: 't2' }],
      // 平台管理者的畫面（docs/architecture/backend/08-realtime.md §3.6）
      [
        DomainEvent.PLATFORM_CHANGED,
        { changes: [{ resource: 'platformFeatureFlag', kind: 'update', id: 'levelEditor.v2' }] },
      ],
    ]);
    expect(calls.slice(0, 4)).toEqual(['transaction', 'audit', 'reload', 'publish']);
    expect(result.globalState).toBe('off');
  });

  it('default：移除全平台覆寫', async () => {
    const { service, repo, audit } = setup('on');

    const result = await service.update('levelEditor.v2', { state: 'default' }, ACTOR);

    expect(repo.clearGlobal).toHaveBeenCalledWith('levelEditor.v2', 'tx');
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: { key: 'levelEditor.v2', before: 'on', after: 'default' },
      }),
      'tx',
    );
    expect(result.globalState).toBeNull();
  });

  it('沒有變 → 不寫稽核、不推播', async () => {
    const { service, repo, audit, events } = setup('on');

    await service.update('levelEditor.v2', { state: 'on' }, ACTOR);

    expect(repo.setGlobal).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
    expect(events.publish).not.toHaveBeenCalled();
  });

  it('不在目錄裡的 key → FEATURE_FLAG_NOT_FOUND，不開交易', async () => {
    const { service, repo } = setup();

    await expect(service.update('gone.flag', { state: 'on' }, ACTOR)).rejects.toMatchObject({
      code: 'FEATURE_FLAG_NOT_FOUND',
    });
    expect(repo.transaction).not.toHaveBeenCalled();
  });
});
