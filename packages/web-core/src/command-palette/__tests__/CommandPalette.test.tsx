import { createRoute } from '@tanstack/react-router';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { useGlobalHotkeys } from '../../hotkey';
import { resetHotkeyRegistry } from '../../hotkey';
import { registerNavGroup, registerNavItem, resetNavigationRegistry } from '../../navigation';
import {
  definePageKey,
  registerPagePermission,
  resetPagePermissionRegistry,
} from '../../permission';
import type { PermissionKey } from '../../permission';
import { registerRouteLink, resetRouteLinkRegistry } from '../../route-link';
import { RootRoute } from '../../router';
import { initTestI18n } from '../../testing/i18n';
import { renderRoute } from '../../testing/renderRoute';
import { resetHeaderToolRegistry } from '../../toolbar';
import { CommandPalette } from '../CommandPalette';
import { useRecentPageStore } from '../recent';
import { registerCommandPalette } from '../register';
import {
  registerPaletteCommand,
  registerSearchProvider,
  resetCommandPaletteRegistry,
} from '../registry';
import type { SearchResult } from '../registry';
import { useCommandPaletteStore } from '../store';

const HOME = definePageKey('home');
const USER = definePageKey('user');
const USER_CREATE = definePageKey('userCreate');
const JOB = definePageKey('job');

const LABELS = {
  menu: { home: '首頁', user: '使用者', job: '背景工作', group: { people: '人員管理' } },
  test: { createUser: '建立使用者', toggle: '切換一下' },
};

function Host({ path }: { path: string }) {
  useGlobalHotkeys();
  return (
    <>
      <p data-testid="page">{path}</p>
      <CommandPalette />
    </>
  );
}

const paths = ['/', '/user', '/user/create', '/user/$userId', '/job'];
const routes = paths.map((path) =>
  createRoute({
    getParentRoute: () => RootRoute,
    path,
    component: () => <Host path={path} />,
  }),
);
const userDetailRoute = routes[3];

const searchUsers = vi.fn<(query: string, signal: AbortSignal) => Promise<SearchResult[]>>();
const runToggle = vi.fn();

function renderPalette(permissions: PermissionKey[] | 'unhydrated' = ['user:read']) {
  const result = renderRoute(routes, '/', permissions);
  act(() => useCommandPaletteStore.getState().setOpen(true));
  return result;
}

const input = () => screen.findByTestId('command-palette-input');
const sectionKeys = () =>
  screen.getAllByTestId('command-palette-section').map((section) => section.dataset.value);
const optionIds = () =>
  screen.queryAllByTestId('command-palette-item').map((option) => option.dataset.value);

beforeAll(() => initTestI18n(LABELS));

beforeEach(() => {
  resetPagePermissionRegistry();
  resetNavigationRegistry();
  resetRouteLinkRegistry();
  resetCommandPaletteRegistry();
  resetHotkeyRegistry();
  resetHeaderToolRegistry();
  useCommandPaletteStore.setState({ open: false });
  useRecentPageStore.setState({ pages: [] });
  searchUsers.mockReset().mockResolvedValue([
    {
      id: 'u1',
      label: 'Mei Lin',
      description: 'mei@example.com',
      link: { route: 'user.detail', params: { userId: 'u1' } },
    },
    // 所屬 feature 沒安裝的連結：解析不出來，不顯示
    { id: 'x', label: 'Ghost', link: { route: 'missing.page', params: {} } },
  ]);
  runToggle.mockReset();

  const every = 'every' as const;
  registerPagePermission(HOME, { route: '/', rule: { access: [], match: every } });
  registerPagePermission(USER, { route: '/user', rule: { access: ['user:read'], match: every } });
  registerPagePermission(USER_CREATE, {
    route: '/user/create',
    rule: { access: ['user:read', 'user:create'], match: every },
  });
  registerPagePermission(JOB, { route: '/job', rule: { access: ['job:read'], match: every } });
  registerRouteLink('user.detail', { route: userDetailRoute, params: { userId: 'userId' } });

  registerNavGroup({ key: 'people', labelKey: 'menu.group.people', testId: 'g', order: 100 });
  const nav = { testId: 'menu', order: 100 };
  registerNavItem({ ...nav, pageKey: HOME, to: '/', labelKey: 'menu.home', icon: 'home' });
  registerNavItem({
    ...nav,
    pageKey: USER,
    to: '/user',
    labelKey: 'menu.user',
    icon: 'users',
    group: 'people',
  });
  registerNavItem({
    ...nav,
    pageKey: JOB,
    to: '/job',
    labelKey: 'menu.job',
    icon: 'monitor',
    group: 'people',
    order: 200,
  });
  registerSearchProvider({
    key: 'user',
    labelI18nKey: 'menu.user',
    icon: 'user',
    pageKey: USER,
    order: 100,
    search: searchUsers,
  });
  registerPaletteCommand({
    key: 'user.create',
    labelI18nKey: 'test.createUser',
    icon: 'plus',
    pageKey: USER_CREATE,
    order: 100,
    to: '/user/create',
  });
  registerPaletteCommand({
    key: 'toggle',
    labelI18nKey: 'test.toggle',
    icon: 'sun',
    order: 200,
    run: runToggle,
  });
});

afterEach(() => {
  act(() => useCommandPaletteStore.setState({ open: false }));
});

describe('CommandPalette（docs/architecture/frontend/18-command-palette.md）', () => {
  it('沒有輸入時列出頁面與動作，都依頁面權限過濾；不搜尋資料', async () => {
    renderPalette(['user:read']);
    await input();
    expect(sectionKeys()).toEqual(['pages', 'commands']);
    // 背景工作沒有 job:read、建立使用者沒有 user:create
    expect(optionIds()).toEqual(['pages:home', 'pages:user', 'commands:toggle']);
    expect(searchUsers).not.toHaveBeenCalled();
  });

  it('最近造訪：依造訪順序列出，現在進不了的頁面略過', async () => {
    useRecentPageStore.setState({ pages: [JOB, USER] });
    renderPalette(['user:read']);
    await input();
    expect(sectionKeys()[0]).toBe('recent');
    const recent = screen.getAllByTestId('command-palette-section')[0];
    expect(
      within(recent!)
        .getAllByTestId('command-palette-item')
        .map((option) => option.dataset.value),
    ).toEqual(['recent:user']);
  });

  it('輸入後：頁面與動作以名稱比對；停止打字後才搜尋資料，解析不出連結的結果不顯示', async () => {
    renderPalette(['user:read', 'user:create']);
    fireEvent.change(await input(), { target: { value: '使用者' } });
    expect(optionIds()).toEqual(['pages:user', 'commands:user.create']);
    expect(searchUsers).not.toHaveBeenCalled();

    expect(await screen.findByText('Mei Lin')).toBeInTheDocument();
    expect(searchUsers).toHaveBeenCalledOnce();
    expect(searchUsers.mock.calls[0]?.[0]).toBe('使用者');
    expect(searchUsers.mock.calls[0]?.[1]).toBeInstanceOf(AbortSignal);
    expect(screen.getByText('mei@example.com')).toBeInTheDocument();
    expect(screen.queryByText('Ghost')).not.toBeInTheDocument();
  });

  it('還在防彈跳或搜尋中時不顯示「沒有符合的結果」', async () => {
    searchUsers.mockReturnValue(new Promise(() => undefined));
    renderPalette(['user:read']);
    fireEvent.change(await input(), { target: { value: 'zzz' } });
    expect(screen.queryByTestId('command-palette-empty')).not.toBeInTheDocument();
    expect(await screen.findByTestId('command-palette-loading')).toBeInTheDocument();
    expect(screen.queryByTestId('command-palette-empty')).not.toBeInTheDocument();
  });

  it('進不了提供者的頁面時不發請求', async () => {
    renderPalette([]);
    fireEvent.change(await input(), { target: { value: 'mei' } });
    expect(await screen.findByTestId('command-palette-empty')).toHaveTextContent('沒有符合的結果');
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(searchUsers).not.toHaveBeenCalled();
  });

  it('搜尋失敗時該組顯示失敗，其他結果照常', async () => {
    searchUsers.mockRejectedValue(new Error('boom'));
    renderPalette(['user:read']);
    fireEvent.change(await input(), { target: { value: '使用者' } });
    expect(await screen.findByTestId('command-palette-error')).toHaveTextContent('搜尋失敗');
    expect(optionIds()).toEqual(['pages:user']);
  });

  it('Enter 開啟作用中的選項：預設是第一個，方向鍵移動；開啟後面板關閉', async () => {
    const { router } = renderPalette(['user:read']);
    const field = await input();
    expect(field).toHaveAttribute('aria-activedescendant');
    const first = screen.getAllByTestId('command-palette-item')[0];
    expect(first).toHaveAttribute('aria-selected', 'true');

    fireEvent.keyDown(field, { key: 'ArrowDown' });
    expect(screen.getAllByTestId('command-palette-item')[1]).toHaveAttribute(
      'aria-selected',
      'true',
    );
    fireEvent.keyDown(field, { key: 'Enter' });

    await waitFor(() => expect(router.state.location.pathname).toBe('/user'));
    expect(useCommandPaletteStore.getState().open).toBe(false);
  });

  it('選資料結果時前往連結的頁面；執行型動作在關閉後執行', async () => {
    const { router } = renderPalette(['user:read']);
    fireEvent.change(await input(), { target: { value: 'mei' } });
    fireEvent.click(await screen.findByText('Mei Lin'));
    await waitFor(() => expect(router.state.location.pathname).toBe('/user/u1'));

    act(() => useCommandPaletteStore.getState().setOpen(true));
    fireEvent.change(await input(), { target: { value: '切換' } });
    fireEvent.keyDown(await input(), { key: 'Enter' });
    expect(runToggle).toHaveBeenCalledOnce();
    expect(useCommandPaletteStore.getState().open).toBe(false);
  });

  it('⌘K／Ctrl+K 開關面板（在輸入框裡也可以）', async () => {
    registerCommandPalette();
    renderRoute(routes, '/', ['user:read']);
    expect(await screen.findByTestId('page')).toBeInTheDocument();
    // jsdom 的 navigator.platform 不是 Mac：mod 是 Ctrl
    fireEvent.keyDown(document.body, { key: 'k', ctrlKey: true });
    const field = await input();
    fireEvent.keyDown(field, { key: 'k', ctrlKey: true });
    await waitFor(() =>
      expect(screen.queryByTestId('command-palette-input')).not.toBeInTheDocument(),
    );
  });
});
