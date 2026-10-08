import { AppError } from '@b2b-system/web-core/errors';
import { AllProviders } from '@b2b-system/web-core/testing';
import { act, fireEvent, renderHook, screen, waitFor } from '@testing-library/react';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { featureStore, resetFeatureStore } from '@/core/feature';
import { initTestI18n } from '@/test/i18n';

import zhTW from '../../locales/zh_TW.json';
import {
  useFileDeleteMutation,
  useFileRenameMutation,
  useFileRestoreMutation,
} from '../useFileMutations';

const api = vi.hoisted(() => ({
  rename: vi.fn(),
  remove: vi.fn(),
  restore: vi.fn(),
  invalidateResources: vi.fn(),
}));
vi.mock('@/apis/file/update-file/fetcher', () => ({ fetchFileUpdateMutation: api.rename }));
vi.mock('@/apis/file/delete-file/fetcher', () => ({ fetchFileDeleteMutation: api.remove }));
vi.mock('@/apis/file/restore-file/fetcher', () => ({ fetchFileRestoreMutation: api.restore }));
vi.mock('@/apis/resources', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  invalidateResources: api.invalidateResources,
}));

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

describe('useFileRenameMutation', () => {
  it('改名成功 → 宣告 file update 並提示', async () => {
    api.rename.mockResolvedValue({ id: 'a1', name: 'b.pdf' });
    const result = render(() => useFileRenameMutation());
    act(() => result.current.mutate({ params: { fileId: 'a1' } as never }));
    expect(await screen.findByText('已重新命名')).toBeInTheDocument();
    expect(api.invalidateResources).toHaveBeenCalledWith([
      { resource: 'file', kind: 'update', id: 'a1' },
    ]);
  });

  it('版本衝突 → 失效該檔案，錯誤交給呼叫端（不彈 toast）', async () => {
    api.rename.mockRejectedValue(new AppError('FILE_VERSION_CONFLICT', 409));
    const result = render(() => useFileRenameMutation());
    act(() => result.current.mutate({ params: { fileId: 'a1' } as never }));
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(api.invalidateResources).toHaveBeenCalledWith([
      { resource: 'file', kind: 'update', id: 'a1' },
    ]);
    expect(
      screen.queryByText('這個檔案已經被其他人修改，請重新整理後再試。'),
    ).not.toBeInTheDocument();
  });

  it('其他錯誤 → 不失效，錯誤交給呼叫端', async () => {
    api.rename.mockRejectedValue(new AppError('AUTHZ_FORBIDDEN', 403));
    const result = render(() => useFileRenameMutation());
    act(() => result.current.mutate({ params: { fileId: 'a1' } as never }));
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(api.invalidateResources).not.toHaveBeenCalled();
    expect(screen.queryByText(FORBIDDEN_MESSAGE)).not.toBeInTheDocument();
  });
});

describe('useFileDeleteMutation', () => {
  it('刪除成功 → 宣告 file delete，提示的「復原」按下就還原', async () => {
    api.remove.mockResolvedValue(undefined);
    api.restore.mockResolvedValue({ id: 'a1', name: 'a.pdf' });
    const result = render(() => useFileDeleteMutation());
    act(() => result.current.mutate({ params: { fileId: 'a1' } }));
    expect(await screen.findByText('已刪除檔案')).toBeInTheDocument();
    expect(api.invalidateResources).toHaveBeenCalledWith([
      { resource: 'file', kind: 'delete', id: 'a1' },
    ]);

    fireEvent.click(screen.getByRole('button', { name: '復原' }));
    await waitFor(() => expect(api.restore).toHaveBeenCalledTimes(1));
    expect(api.restore.mock.calls[0]![0].params).toEqual({ fileId: 'a1' });
  });

  it('租戶沒有啟用回收桶 → 提示沒有「復原」', async () => {
    featureStore.setState({ statuses: new Map() });
    api.remove.mockResolvedValue(undefined);
    const result = render(() => useFileDeleteMutation());
    act(() => result.current.mutate({ params: { fileId: 'a1' } }));
    expect(await screen.findByText('已刪除檔案')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '復原' })).not.toBeInTheDocument();
  });

  it('別人已經刪掉（FILE_NOT_FOUND）→ 照樣失效，並顯示錯誤', async () => {
    api.remove.mockRejectedValue(new AppError('FILE_NOT_FOUND', 404));
    const result = render(() => useFileDeleteMutation());
    act(() => result.current.mutate({ params: { fileId: 'a1' } }));
    expect(await screen.findByText('找不到這個檔案，可能已被刪除。')).toBeInTheDocument();
    expect(api.invalidateResources).toHaveBeenCalledWith([
      { resource: 'file', kind: 'delete', id: 'a1' },
    ]);
  });

  it('其他錯誤 → 只顯示錯誤、不失效', async () => {
    api.remove.mockRejectedValue(new AppError('AUTHZ_FORBIDDEN', 403));
    const result = render(() => useFileDeleteMutation());
    act(() => result.current.mutate({ params: { fileId: 'a1' } }));
    expect(await screen.findByText(FORBIDDEN_MESSAGE)).toBeInTheDocument();
    expect(api.invalidateResources).not.toHaveBeenCalled();
  });
});

describe('useFileRestoreMutation', () => {
  it('還原成功 → 以 file create 宣告並提示名稱', async () => {
    api.restore.mockResolvedValue({ id: 'a1', name: 'a.pdf' });
    const result = render(() => useFileRestoreMutation());
    act(() => result.current.mutate({ params: { fileId: 'a1' } }));
    expect(await screen.findByText('已還原「a.pdf」。')).toBeInTheDocument();
    expect(api.invalidateResources).toHaveBeenCalledWith([
      { resource: 'file', kind: 'create', id: 'a1' },
    ]);
  });

  it.each([
    {
      reason: 'parentDeleted',
      message: '所在的資料夾已被刪除，請先在回收桶的「資料夾」分頁還原資料夾。',
    },
    { reason: 'objectMissing', message: '這個檔案的內容已不存在，無法還原。' },
    { reason: 'other', message: '無法還原這個檔案。' },
  ])('FILE_RESTORE_CONFLICT（$reason）→ 「$message」', async ({ reason, message }) => {
    api.restore.mockRejectedValue(new AppError('FILE_RESTORE_CONFLICT', 409, { reason }));
    const result = render(() => useFileRestoreMutation());
    act(() => result.current.mutate({ params: { fileId: 'a1' } }));
    expect(await screen.findByText(message)).toBeInTheDocument();
  });

  it('非 AppError 的錯誤 → 顯示通用錯誤訊息', async () => {
    api.restore.mockRejectedValue(new Error('boom'));
    const result = render(() => useFileRestoreMutation());
    act(() => result.current.mutate({ params: { fileId: 'a1' } }));
    expect(await screen.findByText('發生未預期的錯誤，請稍後再試。')).toBeInTheDocument();
  });
});
