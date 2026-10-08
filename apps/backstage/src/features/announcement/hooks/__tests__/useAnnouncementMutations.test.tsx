import { AppError } from '@b2b-system/web-core/errors';
import { AllProviders } from '@b2b-system/web-core/testing';
import { act, fireEvent, renderHook, screen, waitFor } from '@testing-library/react';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { featureStore, resetFeatureStore } from '@/core/feature';
import { initTestI18n } from '@/test/i18n';

import zhTW from '../../locales/zh_TW.json';
import {
  useAnnouncementCreateMutation,
  useAnnouncementDeleteMutation,
  useAnnouncementDispatchRevokeMutation,
  useAnnouncementPauseMutation,
  useAnnouncementPublishMutation,
  useAnnouncementRestoreMutation,
  useAnnouncementResumeMutation,
  useAnnouncementUpdateMutation,
} from '../useAnnouncementMutations';

const api = vi.hoisted(() => ({
  create: vi.fn(),
  update: vi.fn(),
  publish: vi.fn(),
  pause: vi.fn(),
  resume: vi.fn(),
  restore: vi.fn(),
  remove: vi.fn(),
  revoke: vi.fn(),
  invalidateResources: vi.fn(),
}));
vi.mock('@/apis/announcement/create-announcement/fetcher', () => ({
  fetchAnnouncementCreateMutation: api.create,
}));
vi.mock('@/apis/announcement/update-announcement/fetcher', () => ({
  fetchAnnouncementUpdateMutation: api.update,
}));
vi.mock('@/apis/announcement/publish-announcement/fetcher', () => ({
  fetchAnnouncementPublishMutation: api.publish,
}));
vi.mock('@/apis/announcement/pause-announcement/fetcher', () => ({
  fetchAnnouncementPauseMutation: api.pause,
}));
vi.mock('@/apis/announcement/resume-announcement/fetcher', () => ({
  fetchAnnouncementResumeMutation: api.resume,
}));
vi.mock('@/apis/announcement/restore-announcement/fetcher', () => ({
  fetchAnnouncementRestoreMutation: api.restore,
}));
vi.mock('@/apis/announcement/delete-announcement/fetcher', () => ({
  fetchAnnouncementDeleteMutation: api.remove,
}));
vi.mock('@/apis/announcement/revoke-announcement-dispatch/fetcher', () => ({
  fetchAnnouncementDispatchRevokeMutation: api.revoke,
}));
vi.mock('@/apis/resources', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  invalidateResources: api.invalidateResources,
}));

const ANNOUNCEMENT = { id: 'n1', title: '系統維護' };
const UPDATED = [{ resource: 'announcement', kind: 'update', id: 'n1' }];
const CONFLICT = new AppError('ANNOUNCEMENT_VERSION_CONFLICT', 409);
const CONFLICT_MESSAGE = '這則公告已被其他人修改，請重新載入後再編輯。';
const FORBIDDEN = new AppError('AUTHZ_FORBIDDEN', 403);
const FORBIDDEN_MESSAGE = '你沒有執行這個操作的權限。';

function render<T>(hook: () => T) {
  return renderHook(hook, { wrapper: AllProviders }).result;
}

beforeAll(() => initTestI18n(zhTW));

beforeEach(() => {
  vi.clearAllMocks();
  resetFeatureStore();
  featureStore.setState({ resolved: true, statuses: new Map([['trash', 'ready']]) });
});

describe('useAnnouncementCreateMutation', () => {
  it('建立草稿 → 宣告 announcement create，不彈 toast', async () => {
    api.create.mockResolvedValue(ANNOUNCEMENT);
    const result = render(() => useAnnouncementCreateMutation());
    act(() => result.current.mutate({ params: {} as never }));
    await waitFor(() =>
      expect(api.invalidateResources).toHaveBeenCalledWith([
        { resource: 'announcement', kind: 'create', id: 'n1' },
      ]),
    );
  });
});

describe('useAnnouncementUpdateMutation', () => {
  it('儲存成功 → 宣告 announcement update 並提示', async () => {
    api.update.mockResolvedValue(ANNOUNCEMENT);
    const result = render(() => useAnnouncementUpdateMutation());
    act(() => result.current.mutate({ params: { announcementId: 'n1' } as never }));
    expect(await screen.findByText('已儲存公告')).toBeInTheDocument();
    expect(api.invalidateResources).toHaveBeenCalledWith(UPDATED);
  });

  it('版本衝突 → 失效該公告，不彈 toast（交給表單）', async () => {
    api.update.mockRejectedValue(CONFLICT);
    const result = render(() => useAnnouncementUpdateMutation());
    act(() => result.current.mutate({ params: { announcementId: 'n1' } as never }));
    await waitFor(() => expect(api.invalidateResources).toHaveBeenCalledWith(UPDATED));
    expect(screen.queryByText(CONFLICT_MESSAGE)).not.toBeInTheDocument();
  });

  it('其他錯誤 → 不失效也不彈 toast', async () => {
    api.update.mockRejectedValue(FORBIDDEN);
    const result = render(() => useAnnouncementUpdateMutation());
    act(() => result.current.mutate({ params: { announcementId: 'n1' } as never }));
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(api.invalidateResources).not.toHaveBeenCalled();
    expect(screen.queryByText(FORBIDDEN_MESSAGE)).not.toBeInTheDocument();
  });
});

describe.each([
  {
    name: 'useAnnouncementPublishMutation',
    hook: useAnnouncementPublishMutation,
    fn: api.publish,
    message: '已送出公告',
  },
  {
    name: 'useAnnouncementPauseMutation',
    hook: useAnnouncementPauseMutation,
    fn: api.pause,
    message: '已暫停排程',
  },
  {
    name: 'useAnnouncementResumeMutation',
    hook: useAnnouncementResumeMutation,
    fn: api.resume,
    message: '已恢復排程',
  },
])('$name', ({ hook, fn, message }) => {
  it('成功 → 宣告 announcement update 並提示', async () => {
    fn.mockResolvedValue(ANNOUNCEMENT);
    const result = render(() => hook());
    act(() => result.current.mutate({ params: { announcementId: 'n1' } as never }));
    expect(await screen.findByText(message)).toBeInTheDocument();
    expect(api.invalidateResources).toHaveBeenCalledWith(UPDATED);
  });

  it('版本衝突 → 失效該公告並以 toast 顯示', async () => {
    fn.mockRejectedValue(CONFLICT);
    const result = render(() => hook());
    act(() => result.current.mutate({ params: { announcementId: 'n1' } as never }));
    expect(await screen.findByText(CONFLICT_MESSAGE)).toBeInTheDocument();
    expect(api.invalidateResources).toHaveBeenCalledWith(UPDATED);
  });

  it('其他錯誤（受眾是空的、時間已過）→ 只以 toast 顯示', async () => {
    fn.mockRejectedValue(FORBIDDEN);
    const result = render(() => hook());
    act(() => result.current.mutate({ params: { announcementId: 'n1' } as never }));
    expect(await screen.findByText(FORBIDDEN_MESSAGE)).toBeInTheDocument();
    expect(api.invalidateResources).not.toHaveBeenCalled();
  });
});

describe('useAnnouncementRestoreMutation', () => {
  it('還原成功 → 以 announcement create 宣告並提示標題', async () => {
    api.restore.mockResolvedValue(ANNOUNCEMENT);
    const result = render(() => useAnnouncementRestoreMutation());
    act(() => result.current.mutate({ params: { announcementId: 'n1' } }));
    expect(await screen.findByText('已還原「系統維護」')).toBeInTheDocument();
    expect(api.invalidateResources).toHaveBeenCalledWith([
      { resource: 'announcement', kind: 'create', id: 'n1' },
    ]);
  });

  it('失敗 → 以 toast 顯示錯誤', async () => {
    api.restore.mockRejectedValue(FORBIDDEN);
    const result = render(() => useAnnouncementRestoreMutation());
    act(() => result.current.mutate({ params: { announcementId: 'n1' } }));
    expect(await screen.findByText(FORBIDDEN_MESSAGE)).toBeInTheDocument();
  });
});

describe('useAnnouncementDeleteMutation', () => {
  it('刪除成功 → 宣告 announcement delete，提示的「復原」按下就還原', async () => {
    api.remove.mockResolvedValue(undefined);
    api.restore.mockResolvedValue(ANNOUNCEMENT);
    const result = render(() => useAnnouncementDeleteMutation());
    act(() => result.current.mutate({ params: { announcementId: 'n1' } }));
    expect(await screen.findByText('已刪除公告')).toBeInTheDocument();
    expect(api.invalidateResources).toHaveBeenCalledWith([
      { resource: 'announcement', kind: 'delete', id: 'n1' },
    ]);

    fireEvent.click(screen.getByRole('button', { name: '復原' }));
    await waitFor(() => expect(api.restore).toHaveBeenCalledTimes(1));
    expect(api.restore.mock.calls[0]![0].params).toEqual({ announcementId: 'n1' });
  });

  it('租戶沒有啟用回收桶 → 提示沒有「復原」', async () => {
    featureStore.setState({ statuses: new Map() });
    api.remove.mockResolvedValue(undefined);
    const result = render(() => useAnnouncementDeleteMutation());
    act(() => result.current.mutate({ params: { announcementId: 'n1' } }));
    expect(await screen.findByText('已刪除公告')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '復原' })).not.toBeInTheDocument();
  });

  it('失敗 → 以 toast 顯示錯誤', async () => {
    api.remove.mockRejectedValue(FORBIDDEN);
    const result = render(() => useAnnouncementDeleteMutation());
    act(() => result.current.mutate({ params: { announcementId: 'n1' } }));
    expect(await screen.findByText(FORBIDDEN_MESSAGE)).toBeInTheDocument();
  });
});

describe('useAnnouncementDispatchRevokeMutation', () => {
  it('撤回成功 → 宣告該公告 update 並提示', async () => {
    api.revoke.mockResolvedValue(undefined);
    const result = render(() => useAnnouncementDispatchRevokeMutation());
    act(() =>
      result.current.mutate({ params: { announcementId: 'n1', dispatchId: 'd1' } as never }),
    );
    expect(await screen.findByText('已撤回')).toBeInTheDocument();
    expect(api.invalidateResources).toHaveBeenCalledWith(UPDATED);
  });

  it('失敗 → 以 toast 顯示錯誤', async () => {
    api.revoke.mockRejectedValue(FORBIDDEN);
    const result = render(() => useAnnouncementDispatchRevokeMutation());
    act(() =>
      result.current.mutate({ params: { announcementId: 'n1', dispatchId: 'd1' } as never }),
    );
    expect(await screen.findByText(FORBIDDEN_MESSAGE)).toBeInTheDocument();
  });
});
