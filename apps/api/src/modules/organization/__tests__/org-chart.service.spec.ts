import { describe, expect, it, vi } from 'vitest';

import { runInTenantContext } from '@/core/tenant';
import type { TenantContext } from '@/core/tenant';

import { OrgChartService } from '../org-chart.service';
import type { OrgUnitRepository } from '../org-unit.repository';

function tenant(features: string[]): TenantContext {
  return { features } as unknown as TenantContext;
}

function setup(chain: Array<{ depth: number; managerIds: string[] }>) {
  const repo = {
    managerChainOfUser: vi.fn(async () => chain),
    managersOfUnit: vi.fn(async () => ['m1']),
  };
  return { service: new OrgChartService(repo as unknown as OrgUnitRepository), repo };
}

describe('OrgChartService.managersOf（docs/architecture/backend/23-organization.md §3、D5）', () => {
  const chain = [
    { depth: 0, managerIds: [] }, // 主要部門沒有主管（或只有自己）
    { depth: 1, managerIds: ['amy'] },
    { depth: 2, managerIds: [] },
    { depth: 3, managerIds: ['ben', 'bob'] },
  ];

  it.each([
    [1, ['amy']],
    [2, ['ben', 'bob']],
    [3, []],
    [0, []],
  ])('第 %i 層 → %j（沒有主管的部門往上跳過）', async (level, expected) => {
    const { service } = setup(chain);
    const result = await runInTenantContext(tenant(['organization']), () =>
      service.managersOf('carl', level),
    );
    expect(result).toEqual(expected);
  });

  it('解析時扣掉申請人自己', async () => {
    const { service, repo } = setup(chain);
    await runInTenantContext(tenant(['organization']), () => service.managersOf('carl', 1));
    expect(repo.managerChainOfUser).toHaveBeenCalledWith('carl', 'carl', undefined);
  });

  it('organization 未啟用 → 空陣列，不查資料庫（D2）', async () => {
    const { service, repo } = setup(chain);
    const result = await runInTenantContext(tenant([]), async () => [
      await service.managersOf('carl', 1),
      await service.managersOfUnit('unit'),
    ]);
    expect(result).toEqual([[], []]);
    expect(repo.managerChainOfUser).not.toHaveBeenCalled();
    expect(repo.managersOfUnit).not.toHaveBeenCalled();
  });
});
