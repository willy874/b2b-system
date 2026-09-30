import { renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { sessionStore } from '@/core/auth';
import { AllProviders } from '@/test/renderWithPermissions';

import { useNotificationUnreadCount } from '../useNotificationUnreadCount';

const { fetchCount } = vi.hoisted(() => ({ fetchCount: vi.fn() }));
vi.mock('@/apis/notification/get-notification-unread-count/fetcher', () => ({
  fetchNotificationUnreadCountQuery: fetchCount,
}));

beforeEach(() => fetchCount.mockReset().mockResolvedValue({ count: 3 }));
afterEach(() => sessionStore.clear());

describe('useNotificationUnreadCount（頂列鈴鐺的未讀數）', () => {
  it('回傳伺服器的未讀數；還沒回來時是 0', async () => {
    sessionStore.presumeSession();
    const { result } = renderHook(() => useNotificationUnreadCount(), { wrapper: AllProviders });
    expect(result.current).toBe(0);
    await waitFor(() => expect(result.current).toBe(3));
  });

  it('沒有 session 時不查詢（登入頁、登出後）', async () => {
    sessionStore.clear();
    const { result } = renderHook(() => useNotificationUnreadCount(), { wrapper: AllProviders });
    expect(fetchCount).not.toHaveBeenCalled();
    expect(result.current).toBe(0);
  });
});
