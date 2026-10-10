import { AppError } from '@b2b-system/web-core/errors';
import { AllProviders } from '@b2b-system/web-core/testing';
import { act, renderHook, screen, waitFor } from '@testing-library/react';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { initTestI18n } from '@/test/i18n';

import zhTW from '../../locales/zh_TW.json';
import { useDeleteNotification } from '../useDeleteNotification';

const api = vi.hoisted(() => ({
  remove: vi.fn(),
  invalidateResources: vi.fn(),
}));
vi.mock('@/apis/notification/delete-notification/fetcher', () => ({
  fetchDeleteNotificationMutation: api.remove,
}));
vi.mock('@/apis/resources', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  invalidateResources: api.invalidateResources,
}));

function render() {
  return renderHook(() => useDeleteNotification(), { wrapper: AllProviders }).result;
}

beforeAll(() => initTestI18n(zhTW));

beforeEach(() => {
  vi.clearAllMocks();
});

describe('useDeleteNotification（列尾的按鈕、詳細內容的「刪除」）', () => {
  it('不確認直接刪除 → 以 notification delete 宣告並提示，沒有「復原」', async () => {
    api.remove.mockResolvedValue(undefined);
    const result = render();
    act(() => result.current('n1'));

    expect(await screen.findByText('已刪除通知')).toBeInTheDocument();
    expect(api.remove.mock.calls[0]![0]).toEqual({ params: { notificationId: 'n1' } });
    expect(api.invalidateResources).toHaveBeenCalledWith([
      { resource: 'notification', kind: 'delete', id: 'n1' },
    ]);
    expect(screen.queryByRole('button', { name: '復原' })).not.toBeInTheDocument();
  });

  it('失敗 → 只以 toast 提示錯誤、不失效', async () => {
    api.remove.mockRejectedValue(new AppError('AUTHZ_FORBIDDEN', 403));
    const result = render();
    act(() => result.current('n1'));

    expect(await screen.findByText('你沒有執行這個操作的權限。')).toBeInTheDocument();
    expect(api.invalidateResources).not.toHaveBeenCalled();
    expect(screen.queryByText('已刪除通知')).not.toBeInTheDocument();
  });

  it('回傳的函式在重新渲染之間保持同一個（可放進依賴陣列）', async () => {
    const hook = renderHook(() => useDeleteNotification(), { wrapper: AllProviders });
    const first = hook.result.current;
    hook.rerender();
    await waitFor(() => expect(hook.result.current).toBe(first));
  });
});
