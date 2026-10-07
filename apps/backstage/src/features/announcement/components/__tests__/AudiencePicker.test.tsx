import { AllProviders } from '@b2b-system/web-core/testing';
import { render, screen } from '@testing-library/react';
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
