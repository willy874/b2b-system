import { installRangeLayoutStub, insertRichText } from '@b2b-system/ui/testing';
import { sessionStore } from '@b2b-system/web-core/auth';
import { formDraftStore, setFormDraftStore } from '@b2b-system/web-core/form';
import { renderRoute } from '@b2b-system/web-core/testing';
import { createDraftStore } from '@b2b-system/web-shared/storage';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

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

beforeAll(() => {
  initTestI18n(zhTW);
  installRangeLayoutStub();
});

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

/**
 * 在內文編輯器輸入：編輯器延遲載入，先等它出現；jsdom 沒辦法模擬 contenteditable 的輸入，
 * 經由 `insertRichText` 直接對編輯器下指令。
 */
async function typeBody(text: string) {
  const textbox = await screen.findByRole('textbox', { name: /內文/ });
  act(() => insertRichText(textbox, text));
}

async function typeTitle() {
  const input = await screen.findByTestId('announcement-title-input', undefined, {
    timeout: 5000,
  });
  fireEvent.change(input, { target: { value: '系統維護' } });
  return input;
}

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
    await typeBody('週六停機');
    expect(submit).toBeEnabled();
    fireEvent.click(submit);

    await waitFor(() => expect(create).toHaveBeenCalledTimes(1));
    expect(create.mock.calls[0]![0]).toMatchObject({
      params: {
        body: {
          title: '系統維護',
          body: {
            type: 'doc',
            content: [{ type: 'paragraph', content: [{ type: 'text', text: '週六停機' }] }],
          },
          audience: { all: true },
          trigger: { kind: 'immediate' },
        },
      },
    });
    await waitFor(() => expect(router.state.location.pathname).toBe('/announcement/a9'));
    // 建立成功後的導覽不經過未儲存提醒
    expect(screen.queryByTestId('unsaved-changes-confirm')).toBeNull();
  });

  describe('未儲存提醒（docs/architecture/frontend/04-routing.md §2.1）', () => {
    it('輸入標題後按 Esc：先確認；選「繼續編輯」後對話框與輸入都還在', async () => {
      renderRoute(routes, '/announcement/create', CREATOR);
      const input = await typeTitle();
      fireEvent.keyDown(input, { key: 'Escape' });

      const confirm = await screen.findByTestId('unsaved-changes-confirm');
      fireEvent.click(within(confirm).getByTestId('alert-dialog-cancel'));
      await waitFor(() => expect(screen.queryByTestId('unsaved-changes-confirm')).toBeNull());
      expect(screen.getByTestId('announcement-create-dialog')).toBeInTheDocument();
      expect(screen.getByTestId('announcement-title-input')).toHaveValue('系統維護');
    });

    it('輸入標題後按取消：先確認；選放棄才關閉', async () => {
      const { router } = renderRoute(routes, '/announcement/create', CREATOR);
      await typeTitle();
      fireEvent.click(screen.getByTestId('announcement-create-cancel'));

      const confirm = await screen.findByTestId('unsaved-changes-confirm');
      fireEvent.click(within(confirm).getByTestId('alert-dialog-confirm'));
      await waitFor(() => expect(router.state.location.pathname).toBe('/announcement'));
    });

    it('沒有輸入時按取消直接關閉', async () => {
      const { router } = renderRoute(routes, '/announcement/create', CREATOR);
      fireEvent.click(
        await screen.findByTestId('announcement-create-cancel', undefined, { timeout: 5000 }),
      );
      await waitFor(() => expect(router.state.location.pathname).toBe('/announcement'));
      expect(screen.queryByTestId('unsaved-changes-confirm')).toBeNull();
    });
  });
});

describe('AnnouncementCreatePage：session 結束時保留的草稿（docs/architecture/frontend/09-state-and-storage.md §4.4）', () => {
  beforeEach(() => {
    setFormDraftStore(createDraftStore({ indexedDB: undefined }));
    // 草稿以登入的身分（`tid:sub`）區分是誰
    vi.spyOn(sessionStore, 'getIdentity').mockReturnValue('t1:me');
  });

  afterEach(() => {
    setFormDraftStore(undefined);
    vi.mocked(sessionStore.getIdentity).mockRestore();
  });

  it('有同一個人的草稿 → 提示；還原後填回內容', async () => {
    await formDraftStore().save('t1:me', 'announcement.create', { title: '上次沒存的標題' });
    renderRoute(routes, '/announcement/create', CREATOR);

    const notice = await screen.findByTestId('form-draft-notice', undefined, { timeout: 5000 });
    fireEvent.click(within(notice).getByTestId('form-draft-restore'));

    await waitFor(() =>
      expect(screen.getByTestId('announcement-title-input')).toHaveValue('上次沒存的標題'),
    );
    expect(screen.queryByTestId('form-draft-notice')).not.toBeInTheDocument();
  });
});
