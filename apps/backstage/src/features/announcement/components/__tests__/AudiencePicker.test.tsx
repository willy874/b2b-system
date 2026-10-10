import { AllProviders } from '@b2b-system/web-core/testing';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { featureStore, resetFeatureStore } from '@/core/feature';
import type { FeatureStatus } from '@/core/feature';
import { initTestI18n } from '@/test/i18n';

import announcementZhTW from '../../locales/zh_TW.json';
import { AudiencePicker } from '../AudiencePicker';

const { fetchGroups, fetchRoles, fetchUsers, fetchPreview } = vi.hoisted(() => ({
  fetchGroups: vi.fn(),
  fetchRoles: vi.fn(),
  fetchUsers: vi.fn(),
  fetchPreview: vi.fn(),
}));
vi.mock('@/apis/group/get-group-list/fetcher', () => ({ fetchGroupListQuery: fetchGroups }));
vi.mock('@/apis/role/get-role-list/fetcher', () => ({ fetchRoleListQuery: fetchRoles }));
vi.mock('@/apis/user/get-user-list/fetcher', () => ({ fetchUserListQuery: fetchUsers }));
vi.mock('@/apis/announcement/preview-announcement-audience/fetcher', () => ({
  fetchAnnouncementAudiencePreviewQuery: fetchPreview,
}));

const EMPTY_LIST = { items: [], pagination: { offset: 0, limit: 100, total: 0 } };

beforeAll(() => initTestI18n(announcementZhTW));

beforeEach(() => {
  fetchGroups.mockReset().mockResolvedValue(EMPTY_LIST);
  fetchRoles.mockReset().mockResolvedValue(EMPTY_LIST);
  fetchUsers.mockReset().mockResolvedValue(EMPTY_LIST);
  fetchPreview.mockReset().mockResolvedValue({ count: 0 });
});

afterEach(() => resetFeatureStore());

function renderWithGroupFeature(status: FeatureStatus) {
  featureStore.setState({ resolved: true, statuses: new Map([['group', status]]) });
  render(
    <AudiencePicker
      value={{ all: false, userIds: [], groupIds: [], roleIds: [] }}
      onChange={vi.fn()}
    />,
    { wrapper: AllProviders },
  );
}

describe('AudiencePicker 的群組欄（docs/architecture/iam/07-groups.md §8）', () => {
  it('租戶啟用 group → 有群組欄並取群組清單', async () => {
    renderWithGroupFeature('ready');
    expect(await screen.findByTestId('announcement-audience-groups')).toBeInTheDocument();
    expect(fetchGroups).toHaveBeenCalled();
  });

  it('沒有啟用 → 沒有群組欄，也不取群組清單（端點會回 404）', async () => {
    renderWithGroupFeature('disabled');
    expect(await screen.findByTestId('announcement-audience-roles')).toBeInTheDocument();
    expect(screen.queryByTestId('announcement-audience-groups')).toBeNull();
    expect(fetchGroups).not.toHaveBeenCalled();
  });
});

describe('AudiencePicker 的人數預覽（docs/architecture/frontend/07-ui-system.md §6.1）', () => {
  it('預覽失敗 → 顯示錯誤與重試，不停在「計算中」；重試成功後顯示人數', async () => {
    fetchPreview.mockRejectedValueOnce(new Error('boom')).mockResolvedValue({ count: 3 });
    renderWithGroupFeature('ready');
    const error = await screen.findByTestId('announcement-audience-count-error');
    expect(screen.queryByTestId('announcement-audience-counting')).toBeNull();
    fireEvent.click(within(error).getByTestId('query-error-retry'));
    expect(await screen.findByTestId('announcement-audience-count')).toHaveTextContent('3');
  });
});

describe('AudiencePicker 的已選使用者', () => {
  it('以 id 一次取回名稱（不逐人查詢）；下拉還沒打開時不搜尋', async () => {
    featureStore.setState({ resolved: true, statuses: new Map([['group', 'ready']]) });
    const ids = ['u1', 'u2', 'u3'];
    fetchUsers.mockResolvedValue({
      items: ids.map((id) => ({ id, displayName: `User ${id}`, email: `${id}@acme.test` })),
      pagination: { offset: 0, limit: 3, total: 3 },
    });
    render(
      <AudiencePicker
        value={{ all: false, userIds: ids, groupIds: [], roleIds: [] }}
        onChange={vi.fn()}
      />,
      { wrapper: AllProviders },
    );
    const field = await screen.findByTestId('announcement-audience-users');
    await waitFor(() => expect(field).toHaveTextContent('User u1'));
    expect(fetchUsers).toHaveBeenCalledTimes(1);
    expect(fetchUsers.mock.calls[0]![0]).toMatchObject({ params: { id: ids, limit: 3 } });
  });
});
