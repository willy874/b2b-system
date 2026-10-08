import { AppError } from '@b2b-system/web-core/errors';
import { renderRoute } from '@b2b-system/web-core/testing';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { PermissionKey } from '@/core/permission';
import { resetPagePermissionRegistry } from '@/core/permission';
import { initTestI18n } from '@/test/i18n';

import { registerAnnouncementPagePermissions, Routes } from '../../..';
import zhTW from '../../../locales/zh_TW.json';

const { fetchList, fetchDetail, fetchDispatches, publish, pause, revoke, update, remove, resume } =
  vi.hoisted(() => ({
    resume: vi.fn(),
    fetchList: vi.fn(),
    fetchDetail: vi.fn(),
    fetchDispatches: vi.fn(),
    publish: vi.fn(),
    pause: vi.fn(),
    revoke: vi.fn(),
    update: vi.fn(),
    remove: vi.fn(),
  }));
vi.mock('@/apis/announcement/get-announcement-list/fetcher', () => ({
  fetchAnnouncementListQuery: fetchList,
}));
vi.mock('@/apis/announcement/get-announcement-detail/fetcher', () => ({
  fetchAnnouncementDetailQuery: fetchDetail,
}));
vi.mock('@/apis/announcement/get-announcement-dispatches/fetcher', () => ({
  fetchAnnouncementDispatchesQuery: fetchDispatches,
}));
vi.mock('@/apis/announcement/publish-announcement/fetcher', () => ({
  fetchAnnouncementPublishMutation: publish,
}));
vi.mock('@/apis/announcement/pause-announcement/fetcher', () => ({
  fetchAnnouncementPauseMutation: pause,
}));
vi.mock('@/apis/announcement/resume-announcement/fetcher', () => ({
  fetchAnnouncementResumeMutation: resume,
}));
vi.mock('@/apis/announcement/revoke-announcement-dispatch/fetcher', () => ({
  fetchAnnouncementDispatchRevokeMutation: revoke,
}));
vi.mock('@/apis/announcement/update-announcement/fetcher', () => ({
  fetchAnnouncementUpdateMutation: update,
}));
vi.mock('@/apis/announcement/delete-announcement/fetcher', () => ({
  fetchAnnouncementDeleteMutation: remove,
}));

/** 內文（富文本）。 */
const BODY = {
  type: 'doc',
  content: [{ type: 'paragraph', content: [{ type: 'text', text: '週六停機' }] }],
};

const DRAFT = {
  id: 'a1',
  title: '系統維護通知',
  body: BODY,
  audience: { all: false, userIds: [], groupIds: ['g1', 'g2'], roleIds: [] },
  trigger: { kind: 'immediate' },
  status: 'draft',
  nextRunAt: null,
  lastDispatch: null,
  version: 3,
  createdAt: '2026-10-01T00:00:00.000Z',
  updatedAt: '2026-10-01T00:00:00.000Z',
  createdBy: null,
  updatedBy: null,
};
const SCHEDULED = {
  ...DRAFT,
  status: 'scheduled',
  trigger: { kind: 'once', at: '2026-12-01T01:00:00.000Z' },
  nextRunAt: '2026-12-01T01:00:00.000Z',
};
const DISPATCH = {
  id: 'd1',
  announcementId: 'a1',
  scheduledFor: '2026-10-01T00:00:00.000Z',
  title: '系統維護通知',
  body: BODY,
  audience: DRAFT.audience,
  status: 'sent',
  recipientCount: 10,
  readCount: 4,
  details: null,
  createdAt: '2026-10-01T00:00:00.000Z',
  startedAt: '2026-10-01T00:00:00.000Z',
  finishedAt: '2026-10-01T00:00:01.000Z',
  revokedAt: null,
  createdBy: { id: 'u1', displayName: '管理員' },
  revokedBy: null,
};
const READER = ['announcement:read'] as PermissionKey[];
/** 能寫草稿、不能發送。 */
const EDITOR = ['announcement:read', 'announcement:update'] as PermissionKey[];
const PUBLISHER = [
  'announcement:read',
  'announcement:update',
  'announcement:publish',
  'announcement:delete',
] as PermissionKey[];
const routes = [Routes.AnnouncementListRoute.addChildren([Routes.AnnouncementDetailRoute])];

beforeAll(() => initTestI18n(zhTW));

beforeEach(() => {
  resetPagePermissionRegistry();
  registerAnnouncementPagePermissions();
  fetchList
    .mockReset()
    .mockResolvedValue({ items: [], pagination: { offset: 0, limit: 20, total: 0 } });
  fetchDetail.mockReset().mockResolvedValue(DRAFT);
  fetchDispatches.mockReset().mockResolvedValue({
    items: [],
    pagination: { offset: 0, limit: 20, total: 0 },
  });
  publish.mockReset().mockResolvedValue({ ...DRAFT, status: 'completed', version: 4 });
  pause.mockReset().mockResolvedValue({ ...SCHEDULED, status: 'paused', version: 4 });
  revoke.mockReset().mockResolvedValue({ ...DISPATCH, status: 'revoked' });
  update.mockReset().mockResolvedValue({ ...DRAFT, title: '改過的標題', version: 4 });
  remove.mockReset().mockResolvedValue(undefined);
  resume.mockReset().mockResolvedValue({ ...SCHEDULED, version: 4 });
  vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined);
});

async function openDetail(permissions: PermissionKey[] | 'unhydrated') {
  const { router } = renderRoute(routes, '/announcement/a1', permissions);
  await screen.findByTestId('announcement-settings-section', undefined, { timeout: 5000 });
  return router;
}

async function startEditing() {
  const router = await openDetail(PUBLISHER);
  fireEvent.click(screen.getByTestId('announcement-edit'));
  const input = await screen.findByTestId('announcement-title-input');
  fireEvent.change(input, { target: { value: '改過的標題' } });
  return { router, input };
}

describe('AnnouncementDetailPage（docs/architecture/backend/19-announcement.md §9 A2）', () => {
  it('草稿 ＋ publish：顯示編輯、送出、刪除；受眾摘要', async () => {
    await openDetail(PUBLISHER);
    expect(screen.getByTestId('announcement-edit')).toBeInTheDocument();
    expect(screen.getByTestId('announcement-publish')).toBeInTheDocument();
    expect(screen.getByTestId('announcement-delete')).toBeInTheDocument();
    expect(screen.getByTestId('announcement-detail-audience')).toHaveTextContent('2 個群組');
  });

  it('只能寫草稿（沒有 publish）：草稿可以編輯但不能送出；排程中的不能改、不能暫停', async () => {
    await openDetail(EDITOR);
    expect(screen.getByTestId('announcement-edit')).toBeInTheDocument();
    expect(screen.queryByTestId('announcement-publish')).toBeNull();

    fetchDetail.mockResolvedValue(SCHEDULED);
    renderRoute(routes, '/announcement/a1', EDITOR);
    await waitFor(() =>
      expect(screen.getAllByTestId('announcement-detail-status').at(-1)).toHaveAttribute(
        'data-value',
        'scheduled',
      ),
    );
    expect(screen.queryAllByTestId('announcement-pause')).toHaveLength(0);
  });

  it('只有 announcement:read：看得到內容與發送紀錄，沒有任何操作', async () => {
    fetchDispatches.mockResolvedValue({
      items: [DISPATCH],
      pagination: { offset: 0, limit: 20, total: 1 },
    });
    await openDetail(READER);
    expect(screen.getByTestId('announcement-detail-body')).toHaveTextContent('週六停機');
    expect(await screen.findByText('4 / 10')).toBeInTheDocument();
    expect(screen.queryByTestId('announcement-edit')).toBeNull();
    expect(screen.queryByTestId('announcement-revoke')).toBeNull();
  });

  it('權限未水合 → 不閃現操作按鈕', async () => {
    await openDetail('unhydrated');
    expect(screen.queryByTestId('announcement-edit')).toBeNull();
    expect(screen.queryByTestId('announcement-publish')).toBeNull();
  });

  it('送出：確認後帶目前的 version 呼叫 publish', async () => {
    await openDetail(PUBLISHER);
    fireEvent.click(screen.getByTestId('announcement-publish'));
    const confirm = await screen.findByTestId('announcement-publish-confirm');
    fireEvent.click(within(confirm).getByRole('button', { name: '送出' }));
    await waitFor(() => expect(publish).toHaveBeenCalledTimes(1));
    expect(publish.mock.calls[0]![0]).toMatchObject({
      params: { announcementId: 'a1', body: { version: 3 } },
    });
  });

  it('排程中：顯示發送時間與暫停；暫停帶 version', async () => {
    fetchDetail.mockResolvedValue(SCHEDULED);
    await openDetail(PUBLISHER);
    fireEvent.click(screen.getByTestId('announcement-pause'));
    await waitFor(() => expect(pause).toHaveBeenCalledTimes(1));
    expect(pause.mock.calls[0]![0]).toMatchObject({
      params: { announcementId: 'a1', body: { version: 3 } },
    });
  });

  it('撤回一次發送：確認後帶公告與發送紀錄的 id；已撤回的沒有按鈕', async () => {
    fetchDetail.mockResolvedValue({ ...DRAFT, status: 'completed' });
    fetchDispatches.mockResolvedValue({
      items: [DISPATCH, { ...DISPATCH, id: 'd0', status: 'revoked' }],
      pagination: { offset: 0, limit: 20, total: 2 },
    });
    await openDetail(PUBLISHER);
    const buttons = await screen.findAllByTestId('announcement-revoke');
    expect(buttons).toHaveLength(1);
    expect(screen.queryByTestId('announcement-edit')).toBeNull(); // 已完成的不能改
    fireEvent.click(buttons[0]!);
    const confirm = await screen.findByTestId('announcement-revoke-confirm');
    fireEvent.click(within(confirm).getByRole('button', { name: '撤回' }));
    await waitFor(() => expect(revoke).toHaveBeenCalledTimes(1));
    expect(revoke.mock.calls[0]![0]).toMatchObject({
      params: { announcementId: 'a1', dispatchId: 'd1' },
    });
  });

  describe('未儲存提醒（docs/architecture/frontend/04-routing.md §2.1）', () => {
    it('編輯中按 Esc：先確認；選「繼續編輯」後對話框與輸入都還在', async () => {
      const { input } = await startEditing();
      fireEvent.keyDown(input, { key: 'Escape' });

      const confirm = await screen.findByTestId('unsaved-changes-confirm');
      fireEvent.click(within(confirm).getByTestId('alert-dialog-cancel'));
      await waitFor(() => expect(screen.queryByTestId('unsaved-changes-confirm')).toBeNull());
      expect(screen.getByTestId('announcement-detail-dialog')).toBeInTheDocument();
      expect(screen.getByTestId('announcement-title-input')).toHaveValue('改過的標題');
    });

    it('編輯中按關閉：先確認；選放棄才關閉', async () => {
      const { router } = await startEditing();
      fireEvent.click(screen.getByRole('button', { name: '關閉' }));

      const confirm = await screen.findByTestId('unsaved-changes-confirm');
      fireEvent.click(within(confirm).getByTestId('alert-dialog-confirm'));
      await waitFor(() => expect(router.state.location.pathname).toBe('/announcement'));
    });

    it('儲存成功後關閉：不確認', async () => {
      const { router } = await startEditing();
      fireEvent.click(screen.getByTestId('announcement-save'));
      await waitFor(() => expect(update).toHaveBeenCalledTimes(1));
      await waitFor(() => expect(screen.queryByTestId('announcement-save')).toBeNull());

      fireEvent.click(screen.getByRole('button', { name: '關閉' }));
      await waitFor(() => expect(router.state.location.pathname).toBe('/announcement'));
      expect(screen.queryByTestId('unsaved-changes-confirm')).toBeNull();
    });

    it('刪除後關閉：不確認', async () => {
      const router = await openDetail(PUBLISHER);
      fireEvent.click(screen.getByTestId('announcement-delete'));
      const confirm = await screen.findByTestId('announcement-delete-confirm');
      fireEvent.click(within(confirm).getByTestId('alert-dialog-confirm'));

      await waitFor(() => expect(router.state.location.pathname).toBe('/announcement'));
      expect(screen.queryByTestId('unsaved-changes-confirm')).toBeNull();
    });
  });

  describe('設定區塊的編輯與狀態（AnnouncementSettingsSection）', () => {
    it('暫停中：可以恢復，帶 version', async () => {
      fetchDetail.mockResolvedValue({ ...SCHEDULED, status: 'paused' });
      await openDetail(PUBLISHER);
      expect(screen.queryByTestId('announcement-pause')).toBeNull();
      fireEvent.click(screen.getByTestId('announcement-resume'));
      await waitFor(() => expect(resume).toHaveBeenCalledTimes(1));
      expect(resume.mock.calls[0]![0]).toMatchObject({
        params: { announcementId: 'a1', body: { version: 3 } },
      });
    });

    it('編輯已送出的公告：提示修改只影響之後的發送；取消回到檢視', async () => {
      fetchDetail.mockResolvedValue(SCHEDULED);
      await openDetail(PUBLISHER);
      fireEvent.click(screen.getByTestId('announcement-edit'));
      expect(
        await screen.findByText('這則公告已送出（排程中或暫停中）：修改只影響之後的發送。'),
      ).toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: '取消' }));
      await waitFor(() => expect(screen.queryByTestId('announcement-save')).toBeNull());
      expect(screen.getByTestId('announcement-detail-status')).toHaveAttribute(
        'data-value',
        'scheduled',
      );
    });

    it('儲存失敗（非版本衝突）→ 錯誤顯示在表單上，輸入保留', async () => {
      update.mockRejectedValue(new AppError('ANNOUNCEMENT_INVALID_STATE', 409));
      const { input } = await startEditing();
      fireEvent.click(screen.getByTestId('announcement-save'));
      expect(
        await screen.findByText('公告目前的狀態不能這樣操作，請重新整理後再試。'),
      ).toBeInTheDocument();
      expect(input).toHaveValue('改過的標題');
      expect(update.mock.calls[0]![0]).toMatchObject({
        params: { announcementId: 'a1', body: { title: '改過的標題', version: 3 } },
      });
    });

    it('版本衝突 → 重新載入後以最新的內容與版本為基礎', async () => {
      update.mockRejectedValueOnce(new AppError('ANNOUNCEMENT_VERSION_CONFLICT', 409));
      await startEditing();
      fireEvent.click(screen.getByTestId('announcement-save'));
      await screen.findByTestId('version-conflict-alert');

      fetchDetail.mockResolvedValue({ ...DRAFT, title: '別人的標題', version: 8 });
      fireEvent.click(screen.getByTestId('version-conflict-reload'));
      await waitFor(() =>
        expect(screen.getByTestId('announcement-title-input')).toHaveValue('別人的標題'),
      );

      fireEvent.click(screen.getByTestId('announcement-save'));
      await waitFor(() => expect(update).toHaveBeenCalledTimes(2));
      expect(update.mock.calls[1]![0]).toMatchObject({
        params: { body: { title: '別人的標題', version: 8 } },
      });
    });

    it('重新載入失敗 → 以 toast 顯示錯誤', async () => {
      update.mockRejectedValueOnce(new AppError('ANNOUNCEMENT_VERSION_CONFLICT', 409));
      await startEditing();
      fireEvent.click(screen.getByTestId('announcement-save'));
      await screen.findByTestId('version-conflict-alert');

      fetchDetail.mockRejectedValueOnce(new AppError('ANNOUNCEMENT_NOT_FOUND', 404));
      fireEvent.click(screen.getByTestId('version-conflict-reload'));
      expect(await screen.findByText('找不到這則公告，可能已被刪除。')).toBeInTheDocument();
    });
  });
});
