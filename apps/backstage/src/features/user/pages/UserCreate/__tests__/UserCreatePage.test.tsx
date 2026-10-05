import { AppError } from '@b2b-system/web-core/errors';
import { renderRoute } from '@b2b-system/web-core/testing';
import { Outlet } from '@tanstack/react-router';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { PermissionKey } from '@/core/permission';
import { resetPagePermissionRegistry } from '@/core/permission';
import { initTestI18n } from '@/test/i18n';

import { registerUserPagePermissions, Routes } from '../../..';
import userZhTW from '../../../locales/zh_TW.json';

const { createUser, fetchRoles } = vi.hoisted(() => ({
  createUser: vi.fn(),
  fetchRoles: vi.fn(),
}));
vi.mock('@/apis/user/create-user/fetcher', () => ({ fetchUserCreateMutation: createUser }));
vi.mock('@/apis/role/get-role-list/fetcher', () => ({ fetchRoleListQuery: fetchRoles }));

const CREATOR = ['user:read', 'user:create', 'user:assignRole', 'role:read'] as PermissionKey[];
const ROLE = { id: 'r1', slug: 'editor', name: 'Editor', isSystem: false };

Routes.UserListRoute.update({ component: Outlet });
const routes = [Routes.UserListRoute.addChildren([Routes.UserCreateRoute])];

beforeAll(() => initTestI18n(userZhTW));

beforeEach(() => {
  resetPagePermissionRegistry();
  registerUserPagePermissions();
  createUser.mockReset().mockResolvedValue({ id: 'u1', email: 'a@b.test', roles: [] });
  fetchRoles.mockReset().mockResolvedValue({ items: [ROLE], pagination: { total: 1 } });
  vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined);
});

function fill(testId: string, value: string) {
  fireEvent.change(screen.getByTestId(testId), { target: { value } });
}

describe('UserCreatePage', () => {
  it('在欄位按 Enter（送出表單）就會建立，送出鈕與表單相連', async () => {
    renderRoute(routes, '/user/create', CREATOR);
    await screen.findByTestId('user-email-input');

    fill('user-email-input', 'new@acme.test');
    fill('user-display-name-input', 'New');
    expect(screen.getByTestId('user-create-submit')).toHaveAttribute('type', 'submit');
    fireEvent.submit(screen.getByTestId('user-email-input').closest('form') as HTMLFormElement);

    await waitFor(() => expect(createUser).toHaveBeenCalledTimes(1));
    expect(createUser.mock.calls[0]![0]).toMatchObject({
      params: { email: 'new@acme.test', displayName: 'New', roleIds: [] },
    });
    await waitFor(() => expect(screen.queryByTestId('user-create-dialog')).not.toBeInTheDocument());
  });

  it('Email 重複時錯誤顯示在 Email 欄並聚焦該欄', async () => {
    createUser.mockRejectedValue(new AppError('USER_EMAIL_DUPLICATE', 409));
    renderRoute(routes, '/user/create', CREATOR);
    await screen.findByTestId('user-email-input');

    fill('user-email-input', 'dup@acme.test');
    fill('user-display-name-input', 'Dup');
    fireEvent.click(screen.getByTestId('user-create-submit'));

    const email = screen.getByTestId('user-email-input');
    await screen.findByText('這個 Email 已被使用。');
    console.log('DBG', email.parentElement!.outerHTML);
    await waitFor(() => expect(email).toHaveAttribute('aria-invalid', 'true'));
    await waitFor(() => expect(email).toHaveFocus());
    expect(screen.getByTestId('user-create-dialog')).toBeInTheDocument();
  });

  it('其他失敗顯示在表單底部的 alert 區', async () => {
    createUser.mockRejectedValue(new AppError('INTERNAL_ERROR', 500));
    renderRoute(routes, '/user/create', CREATOR);
    await screen.findByTestId('user-email-input');

    fill('user-email-input', 'x@acme.test');
    fill('user-display-name-input', 'X');
    fireEvent.click(screen.getByTestId('user-create-submit'));

    await waitFor(() =>
      expect(
        within(screen.getByTestId('user-create-dialog')).getByRole('alert'),
      ).not.toBeEmptyDOMElement(),
    );
  });

  it('空白送出時顯示中文的必填訊息，不是 Zod 的英文技術字串', async () => {
    renderRoute(routes, '/user/create', CREATOR);
    fireEvent.click(await screen.findByTestId('user-create-submit'));

    expect(await screen.findByText('請輸入有效的 Email')).toBeInTheDocument();
    expect(screen.getByText('請填寫這個欄位')).toBeInTheDocument();
    expect(createUser).not.toHaveBeenCalled();
  });

  it('選填的使用者名稱太短時說明至少幾個字元', async () => {
    renderRoute(routes, '/user/create', CREATOR);
    await screen.findByTestId('user-email-input');
    fill('user-email-input', 'a@acme.test');
    fill('user-display-name-input', 'A');
    fill('user-username-input', 'ab');
    fireEvent.click(screen.getByTestId('user-create-submit'));

    expect(await screen.findByText('至少需要 3 個字元')).toBeInTheDocument();
    expect(createUser).not.toHaveBeenCalled();
  });

  it('填了資料後按取消會先確認放棄變更', async () => {
    renderRoute(routes, '/user/create', CREATOR);
    await screen.findByTestId('user-email-input');

    fill('user-email-input', 'draft@acme.test');
    fireEvent.click(screen.getByTestId('user-create-cancel'));

    expect(await screen.findByTestId('unsaved-changes-confirm')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('alert-dialog-confirm'));
    await waitFor(() => expect(screen.queryByTestId('user-create-dialog')).not.toBeInTheDocument());
  });

  it('沒有改動時按取消直接關閉', async () => {
    renderRoute(routes, '/user/create', CREATOR);

    fireEvent.click(await screen.findByTestId('user-create-cancel'));

    await waitFor(() => expect(screen.queryByTestId('user-create-dialog')).not.toBeInTheDocument());
    expect(screen.queryByTestId('unsaved-changes-confirm')).not.toBeInTheDocument();
  });

  it('有 user:assignRole → 顯示角色下拉；沒有 → 不顯示', async () => {
    const { unmount } = renderRoute(routes, '/user/create', CREATOR);
    expect(await screen.findByTestId('user-role-select')).toBeInTheDocument();
    unmount();

    renderRoute(routes, '/user/create', ['user:read', 'user:create'] as PermissionKey[]);
    await screen.findByTestId('user-create-dialog');
    expect(screen.queryByTestId('user-role-select')).not.toBeInTheDocument();
  });

  it('權限未水合 → 不閃現角色下拉', async () => {
    renderRoute(routes, '/user/create', 'unhydrated');
    await screen.findByTestId('user-create-dialog');
    expect(screen.queryByTestId('user-role-select')).not.toBeInTheDocument();
  });
});
