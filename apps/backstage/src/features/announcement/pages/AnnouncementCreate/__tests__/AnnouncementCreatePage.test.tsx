import { renderRoute } from '@b2b-system/web-core/testing';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { PermissionKey } from '@/core/permission';
import { resetPagePermissionRegistry } from '@/core/permission';
import { initTestI18n } from '@/test/i18n';

import { registerAnnouncementPagePermissions, Routes } from '../../..';
import zhTW from '../../../locales/zh_TW.json';

const { fetchList, create, preview, fetchUsers, fetchGroups, fetchRoles } = vi.hoisted(() => ({
  fetchList: vi.fn(),
  create: vi.fn(),
  preview: vi.fn(),
  fetchUsers: vi.fn(),
  fetchGroups: vi.fn(),
  fetchRoles: vi.fn(),
}));
vi.mock('@/apis/announcement/get-announcement-list/fetcher', () => ({
  fetchAnnouncementListQuery: fetchList,
}));
vi.mock('@/apis/announcement/create-announcement/fetcher', () => ({
  fetchAnnouncementCreateMutation: create,
}));
vi.mock('@/apis/announcement/preview-announcement-audience/fetcher', () => ({
  fetchAnnouncementAudiencePreviewQuery: preview,
}));
vi.mock('@/apis/user/get-user-list/fetcher', () => ({ fetchUserListQuery: fetchUsers }));
vi.mock('@/apis/group/get-group-list/fetcher', () => ({ fetchGroupListQuery: fetchGroups }));
vi.mock('@/apis/role/get-role-list/fetcher', () => ({ fetchRoleListQuery: fetchRoles }));

const EMPTY_PAGE = { items: [], pagination: { offset: 0, limit: 20, total: 0 } };
const CREATOR = ['announcement:read', 'announcement:create'] as PermissionKey[];
const routes = [
  Routes.AnnouncementListRoute.addChildren([
    Routes.AnnouncementCreateRoute,
    Routes.AnnouncementDetailRoute,
  ]),
];

beforeAll(() => initTestI18n(zhTW));

beforeEach(() => {
  resetPagePermissionRegistry();
  registerAnnouncementPagePermissions();
  fetchList.mockReset().mockResolvedValue(EMPTY_PAGE);
  fetchUsers.mockReset().mockResolvedValue(EMPTY_PAGE);
  fetchGroups.mockReset().mockResolvedValue(EMPTY_PAGE);
  fetchRoles.mockReset().mockResolvedValue(EMPTY_PAGE);
  preview.mockReset().mockResolvedValue({
    count: 42,
    skipped: { userIds: [], groupIds: [], roleIds: [] },
  });
  create.mockReset().mockResolvedValue({ id: 'a9' });
  vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined);
});

describe('AnnouncementCreatePage（docs/architecture/backend/19-announcement.md §9 A2）', () => {
  it('選全部 → 顯示預覽人數；填標題與內文後存成草稿（立即發送）', async () => {
    const { router } = renderRoute(routes, '/announcement/create', CREATOR);
    const submit = await screen.findByTestId('announcement-create-submit', undefined, {
      timeout: 5000,
    });
    expect(submit).toBeDisabled();

    fireEvent.click(screen.getByTestId('announcement-audience-all'));
    expect(await screen.findByText('現在送出會發給 42 人')).toBeInTheDocument();
    fireEvent.change(screen.getByTestId('announcement-title-input'), {
      target: { value: '系統維護' },
    });
    fireEvent.change(screen.getByTestId('announcement-body-input'), {
      target: { value: '週六停機' },
    });
    expect(submit).toBeEnabled();
    fireEvent.click(submit);

    await waitFor(() => expect(create).toHaveBeenCalledTimes(1));
    expect(create.mock.calls[0]![0]).toMatchObject({
      params: {
        body: {
          title: '系統維護',
          body: '週六停機',
          audience: { all: true },
          trigger: { kind: 'immediate' },
        },
      },
    });
    await waitFor(() => expect(router.state.location.pathname).toBe('/announcement/a9'));
  });
});
