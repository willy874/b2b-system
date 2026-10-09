import { createRoute } from '@tanstack/react-router';
import { fireEvent, screen } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  definePageKey,
  registerPagePermission,
  resetPagePermissionRegistry,
} from '../../permission';
import type { PermissionKey } from '../../permission';
import { RootRoute } from '../../router';
import { initTestI18n } from '../../testing/i18n';
import { renderRoute } from '../../testing/renderRoute';
import { SideNav } from '../SideNav';
import type { SideNavGroup, SideNavItem } from '../SideNav';

const HOME = definePageKey('home');
const USER = definePageKey('user');
const ROLE = definePageKey('role');
const JOB = definePageKey('job');

const TOP_ITEMS: SideNavItem[] = [
  { pageKey: HOME, to: '/', labelKey: 'menu.home', testId: 'menu-home', icon: 'home' },
];

const GROUPS: SideNavGroup[] = [
  {
    key: 'people',
    labelKey: 'menu.group.people',
    testId: 'menu-group-people',
    items: [
      { pageKey: USER, to: '/user', labelKey: 'menu.user', testId: 'menu-user', icon: 'users' },
      { pageKey: ROLE, to: '/role', labelKey: 'menu.role', testId: 'menu-role', icon: 'shield' },
    ],
  },
  {
    key: 'system',
    labelKey: 'menu.group.system',
    testId: 'menu-group-system',
    items: [
      { pageKey: JOB, to: '/job', labelKey: 'menu.job', testId: 'menu-job', icon: 'monitor' },
    ],
  },
];

const LABELS = {
  layout: { badge_other: '{{name}}：{{count}} 筆待處理' },
  menu: {
    home: '首頁',
    user: '使用者',
    role: '角色',
    job: '背景工作',
    group: { people: '人員管理', system: '系統管理' },
  },
};

function renderNav(
  path: string,
  permissions: PermissionKey[] | 'unhydrated',
  collapsed = false,
  groups = GROUPS,
) {
  const nav = () => <SideNav topItems={TOP_ITEMS} groups={groups} collapsed={collapsed} />;
  const routes = ['/', '/user', '/role', '/job'].map((routePath) =>
    createRoute({ getParentRoute: () => RootRoute, path: routePath, component: nav }),
  );
  return renderRoute(routes, path, permissions);
}

/** 人員管理的兩項都帶徽章，數字由參數決定。 */
const withBadges = (user: number, role: number): SideNavGroup[] => [
  {
    ...GROUPS[0]!,
    items: [
      { ...GROUPS[0]!.items[0]!, useBadge: () => user },
      { ...GROUPS[0]!.items[1]!, useBadge: () => role },
    ],
  },
  GROUPS[1]!,
];

let unregister: Array<() => void> = [];

beforeAll(() => initTestI18n(LABELS));
beforeEach(() => {
  resetPagePermissionRegistry();
  unregister = [
    registerPagePermission(HOME, { route: '/', rule: { access: [], match: 'every' } }),
    registerPagePermission(USER, {
      route: '/user',
      rule: { access: ['user:read'], match: 'every' },
    }),
    registerPagePermission(ROLE, {
      route: '/role',
      rule: { access: ['role:read'], match: 'every' },
    }),
    registerPagePermission(JOB, { route: '/job', rule: { access: ['job:read'], match: 'every' } }),
  ];
});
afterEach(() => {
  for (const dispose of unregister) dispose();
});

describe('SideNav（分組的側邊選單）', () => {
  it('只列出有權限的頁面；分類裡一頁都進不去時連父選單一起隱藏', async () => {
    renderNav('/', ['user:read']);
    expect(await screen.findByTestId('menu-home')).toBeInTheDocument();
    expect(screen.getByTestId('menu-group-people')).toBeInTheDocument();
    expect(screen.queryByTestId('menu-role')).not.toBeInTheDocument();
    expect(screen.queryByTestId('menu-group-system')).not.toBeInTheDocument();
  });

  it('權限未水合時不顯示任何項目，不先全部列出再消失', async () => {
    renderNav('/', 'unhydrated');
    expect(await screen.findByRole('navigation')).toBeEmptyDOMElement();
  });

  it('預設只展開當前頁面所在的分類；收起來時父選單標出當前頁面所在', async () => {
    renderNav('/role', ['user:read', 'role:read', 'job:read']);
    const people = await screen.findByTestId('menu-group-people');
    const system = screen.getByTestId('menu-group-system');
    expect(people).toHaveAttribute('aria-expanded', 'true');
    expect(system).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByTestId('menu-role')).toHaveAttribute('data-active');
    expect(screen.getByTestId('menu-user')).not.toHaveAttribute('data-active');

    fireEvent.click(people);
    expect(people).toHaveAttribute('aria-expanded', 'false');
    expect(people).toHaveAttribute('data-active');
    expect(screen.getByTestId('menu-role')).not.toBeVisible();
  });

  it('手動展開的狀態保留到當前分類改變為止', async () => {
    const { router } = renderNav('/user', ['user:read', 'role:read', 'job:read']);
    const system = await screen.findByTestId('menu-group-system');
    fireEvent.click(system);
    expect(system).toHaveAttribute('aria-expanded', 'true');

    // 同一個分類裡換頁：保留
    await router.navigate({ to: '/role' });
    expect(await screen.findByTestId('menu-group-system')).toHaveAttribute('aria-expanded', 'true');

    // 換到別的分類：回到預設（只展開當前分類）
    await router.navigate({ to: '/job' });
    expect(await screen.findByTestId('menu-group-people')).toHaveAttribute(
      'aria-expanded',
      'false',
    );
  });

  it('收合成圖示欄：沒有父選單，子項全部列出、名稱放在 title', async () => {
    renderNav('/', ['user:read', 'role:read', 'job:read'], true);
    const user = await screen.findByTestId('menu-user');
    expect(user).toHaveAttribute('title', '使用者');
    expect(user).not.toHaveTextContent('使用者');
    expect(screen.getByTestId('menu-job')).toBeVisible();
    expect(screen.queryByTestId('menu-group-people')).not.toBeInTheDocument();
    expect(screen.getAllByRole('separator')).toHaveLength(2);
  });

  describe('徽章（NavItem.useBadge，docs/architecture/frontend/02-plugin-system.md §4.6）', () => {
    const ALL: PermissionKey[] = ['user:read', 'role:read', 'job:read'];

    it('展開的分類裡顯示數字，0 不顯示；超過 99 顯示 99+', async () => {
      renderNav('/user', ALL, false, withBadges(3, 0));
      const user = await screen.findByTestId('menu-user');
      expect(user).toContainElement(screen.getByTestId('nav-badge'));
      expect(screen.getByTestId('nav-badge')).toHaveTextContent('3');
      expect(screen.getByTestId('nav-badge')).toHaveTextContent('使用者：3 筆待處理');
      // 連結的名稱帶上徽章的說明
      expect(user).toHaveAccessibleName(/使用者：3 筆待處理/);
      expect(screen.getByTestId('menu-role')).not.toContainElement(
        screen.queryByTestId('nav-badge'),
      );
    });

    it('超過 99 顯示 99+', async () => {
      renderNav('/user', ALL, false, withBadges(120, 0));
      expect(await screen.findByTestId('nav-badge')).toHaveTextContent(/^99\+/);
    });

    it('收起來的分類在父選單顯示點；展開後改成項目上的數字', async () => {
      renderNav('/job', ALL, false, withBadges(3, 2));
      const people = await screen.findByTestId('menu-group-people');
      expect(people).toHaveAttribute('aria-expanded', 'false');
      // 兩項都有：DOM 上有兩個點，CSS 只顯示第一個
      expect(people.querySelectorAll('[data-testid="nav-badge-dot"]')).toHaveLength(2);

      fireEvent.click(people);
      expect(people.querySelector('[data-testid="nav-badge-dot"]')).toBeNull();
      expect(screen.getAllByTestId('nav-badge')).toHaveLength(2);
    });

    it('圖示欄：項目上只顯示點', async () => {
      renderNav('/', ALL, true, withBadges(3, 0));
      const user = await screen.findByTestId('menu-user');
      expect(user.querySelector('[data-testid="nav-badge-dot"]')).not.toBeNull();
      expect(screen.queryByTestId('nav-badge')).not.toBeInTheDocument();
    });
  });
});
