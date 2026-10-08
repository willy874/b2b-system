import { AppError } from '@b2b-system/web-core/errors';
import { i18n } from '@b2b-system/web-core/locales';
import { useLocaleStore } from '@b2b-system/web-core/store';
import { AllProviders } from '@b2b-system/web-core/testing';
import { act, renderHook, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { initTestI18n } from '@/test/i18n';

import { useChangeLocale } from '../useChangeLocale';

const api = vi.hoisted(() => ({ update: vi.fn(), invalidateResources: vi.fn() }));
vi.mock('@/apis/auth/update-profile/fetcher', () => ({ fetchUpdateProfileMutation: api.update }));
vi.mock('@/apis/resources', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  invalidateResources: api.invalidateResources,
}));

const PROFILE = { user: { id: 'me' }, roles: [{ id: 'r1' }] };

beforeAll(() => initTestI18n());

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  // 從另一個語系切回測試用的繁中：i18n 本身維持 zh-TW，其他測試的字串不受影響
  useLocaleStore.setState({ locale: 'en-US' });
});

afterEach(() => localStorage.clear());

describe('useChangeLocale（偏好頁與頂列共用，docs/architecture/frontend/08-i18n.md §1）', () => {
  it('寫入本機偏好、切換 i18n，並把語系同步到帳號', async () => {
    api.update.mockResolvedValue(PROFILE);
    const { result } = renderHook(() => useChangeLocale(), { wrapper: AllProviders });
    act(() => result.current('zh-TW'));
    expect(useLocaleStore.getState().locale).toBe('zh-TW');
    expect(i18n.language).toBe('zh-TW');
    await waitFor(() =>
      expect(api.update.mock.calls[0]![0].params).toEqual({ preferences: { locale: 'zh-TW' } }),
    );
  });

  it('同步成功 → 宣告自己的 user update（帶角色）並呼叫 onSaved', async () => {
    api.update.mockResolvedValue(PROFILE);
    const onSaved = vi.fn();
    const { result } = renderHook(() => useChangeLocale(), { wrapper: AllProviders });
    act(() => result.current('zh-TW', { onSaved }));
    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
    expect(api.invalidateResources).toHaveBeenCalledWith([
      { resource: 'user', kind: 'update', id: 'me', refs: { role: ['r1'] } },
    ]);
  });

  it('同步失敗 → 畫面維持切換後的語系，顯示錯誤、不呼叫 onSaved', async () => {
    api.update.mockRejectedValue(new AppError('AUTHZ_FORBIDDEN', 403));
    const onSaved = vi.fn();
    const { result } = renderHook(() => useChangeLocale(), { wrapper: AllProviders });
    act(() => result.current('zh-TW', { onSaved }));
    expect(await screen.findByText('你沒有執行這個操作的權限。')).toBeInTheDocument();
    expect(useLocaleStore.getState().locale).toBe('zh-TW');
    expect(onSaved).not.toHaveBeenCalled();
  });
});
