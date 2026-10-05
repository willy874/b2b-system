import { sessionStore } from '@b2b-system/web-core/auth';
import { renderRoute } from '@b2b-system/web-core/testing';
import { screen, within } from '@testing-library/react';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { PermissionKey, resetPagePermissionRegistry } from '@/core/permission';
import { initTestI18n } from '@/test/i18n';

import { registerHomePagePermissions, Routes } from '../../..';
import homeZhTW from '../../../locales/zh_TW.json';

const { fetchProfile, fetchTenants } = vi.hoisted(() => ({
  fetchProfile: vi.fn(),
  fetchTenants: vi.fn(),
}));
vi.mock('@/apis/auth/get-profile/fetcher', () => ({ fetchProfileQuery: fetchProfile }));
vi.mock('@/apis/platform-tenant/get-tenant-list/fetcher', () => ({
  fetchTenantListQuery: fetchTenants,
}));

const TOTALS: Record<string, number> = { failed: 2, provisioning: 0, active: 7, disabled: 1 };
const routes = [Routes.HomeRoute];

beforeAll(() => initTestI18n(homeZhTW));

beforeEach(() => {
  resetPagePermissionRegistry();
  registerHomePagePermissions();
  vi.spyOn(sessionStore, 'hasSession').mockReturnValue(true);
  fetchProfile.mockReset().mockResolvedValue({
    admin: { id: 'me', email: 'me@acme.test', displayName: 'Me', role: 'auditor' },
    permissions: ['tenant:read', 'platformJob:read'],
  });
  fetchTenants
    .mockReset()
    .mockImplementation(({ params }: { params: { status: string } }) =>
      Promise.resolve({ items: [], pagination: { total: TOTALS[params.status] ?? 0 } }),
    );
});

describe('HomePage', () => {
  it('列出自己的名稱、角色與持有的權限數', async () => {
    renderRoute(routes, '/', [PermissionKey['tenant:read']]);
    // 角色出現代表 profile 已到
    expect(await screen.findByText('稽核人員')).toBeInTheDocument();
    expect(screen.getByTestId('home-display-name')).toHaveTextContent('Me');
    expect(screen.getByTestId('home-permission-count')).toHaveTextContent('2');
  });

  it('有 tenant:read：各狀態的租戶數，失敗的排在最前面', async () => {
    renderRoute(routes, '/', [PermissionKey['tenant:read']]);
    const cards = await screen.findAllByTestId('home-tenant-count');
    expect(cards.map((card) => card.dataset.value)).toEqual([
      'failed',
      'provisioning',
      'active',
      'disabled',
    ]);
    expect(await within(cards[0]!).findByText('2')).toBeInTheDocument();
    expect(await within(cards[2]!).findByText('7')).toBeInTheDocument();
  });

  it('沒有 tenant:read：不顯示租戶概況，也不查租戶', async () => {
    renderRoute(routes, '/', [PermissionKey['platformJob:read']]);
    expect(await screen.findByTestId('home-page')).toBeInTheDocument();
    expect(screen.queryByTestId('home-tenant-overview')).not.toBeInTheDocument();
    expect(fetchTenants).not.toHaveBeenCalled();
  });

  it('權限未水合：租戶概況不閃現', async () => {
    renderRoute(routes, '/', 'unhydrated');
    expect(await screen.findByTestId('home-page')).toBeInTheDocument();
    expect(screen.queryByTestId('home-tenant-overview')).not.toBeInTheDocument();
  });
});
