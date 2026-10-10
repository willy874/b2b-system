import { renderRoute } from '@b2b-system/web-core/testing';
import { screen, within } from '@testing-library/react';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { registerHomeSection, resetHomeSections } from '@/core/home';
import type { PermissionKey } from '@/core/permission';
import {
  definePageKey,
  PermissionMatch,
  registerPagePermission,
  resetPagePermissionRegistry,
} from '@/core/permission';
import { initTestI18n } from '@/test/i18n';

import { registerHomePagePermissions, Routes } from '../../..';
import homeZhTW from '../../../locales/zh_TW.json';

const { fetchProfile } = vi.hoisted(() => ({ fetchProfile: vi.fn() }));
vi.mock('@/apis/auth/get-profile/fetcher', () => ({ fetchProfileQuery: fetchProfile }));

/** 測試裡控制何時完成的 Promise（`Promise.withResolvers` 不在這個 app 的 lib 裡）。 */
function deferred<T>() {
  const handle: { resolve?: (value: T) => void } = {};
  const promise = new Promise<T>((done) => {
    handle.resolve = done;
  });
  return { promise, resolve: (value: T) => handle.resolve?.(value) };
}

const SECTION_PAGE = definePageKey('TEST_HOME_PAGE_SECTION');
const routes = [Routes.HomeRoute];

beforeAll(() => initTestI18n(homeZhTW));

beforeEach(() => {
  vi.clearAllMocks();
  resetPagePermissionRegistry();
  resetHomeSections();
  registerHomePagePermissions();
  fetchProfile.mockResolvedValue({
    user: { id: 'u-alice', displayName: 'Alice', email: 'alice@example.com' },
    roles: [
      { id: 'r-admin', name: '系統管理員', isSystem: true },
      { id: 'r-editor', name: '內容編輯', isSystem: false },
    ],
    permissions: ['user:read', 'role:read', 'auditLog:read'],
  });
});

describe('首頁（不受權限影響：顯示自己的資料與其他 feature 的區塊）', () => {
  it('列出自己的顯示名稱、email、角色與持有的權限數', async () => {
    renderRoute(routes, '/', []);

    const page = await screen.findByTestId('home-page', undefined, { timeout: 5000 });
    expect(within(page).getByRole('heading', { name: '首頁' })).toBeInTheDocument();
    expect(await within(page).findByText('Alice')).toBeInTheDocument();
    expect(within(page).getByText('alice@example.com')).toBeInTheDocument();
    expect(within(page).getByText('系統管理員')).toBeInTheDocument();
    expect(within(page).getByText('內容編輯')).toBeInTheDocument();
    expect(screen.getByTestId('home-permission-count')).toHaveTextContent('3');
  });

  it('沒有角色 → 顯示「無」；資料還沒到時以「-」與 0 佔位', async () => {
    const profile = deferred<unknown>();
    fetchProfile.mockReturnValue(profile.promise);
    renderRoute(routes, '/', []);

    await screen.findByTestId('home-page', undefined, { timeout: 5000 });
    expect(screen.getByTestId('home-permission-count')).toHaveTextContent('0');
    expect(screen.getAllByText('-')).toHaveLength(2);

    profile.resolve({
      user: { id: 'u-bob', displayName: 'Bob', email: 'bob@example.com' },
      roles: [],
      permissions: [],
    });
    expect(await screen.findByText('Bob')).toBeInTheDocument();
    expect(screen.getByText('無')).toBeInTheDocument();
  });

  it('其他 feature 登記的區塊排在個人資訊之前', async () => {
    registerPagePermission(SECTION_PAGE, {
      route: '/test-home-section',
      rule: { access: [], match: PermissionMatch.EVERY },
    });
    registerHomeSection({
      key: 'test',
      pageKey: SECTION_PAGE,
      order: 100,
      Section: () => <section data-testid="home-test-section">待辦</section>,
    });
    renderRoute(routes, '/', ['user:read' as PermissionKey]);

    const section = await screen.findByTestId('home-test-section', undefined, { timeout: 5000 });
    expect(
      section.compareDocumentPosition(screen.getByTestId('home-permission-count')) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });
});
