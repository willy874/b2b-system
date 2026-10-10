import { AppError } from '@b2b-system/web-core/errors';
import { AllProviders } from '@b2b-system/web-core/testing';
import { act, renderHook, screen, waitFor } from '@testing-library/react';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { initTestI18n } from '@/test/i18n';

import zhTW from '../../locales/zh_TW.json';
import { useUpdateSettingsMutation } from '../useUpdateSettingsMutation';

const api = vi.hoisted(() => ({
  update: vi.fn(),
  invalidateResources: vi.fn(),
}));
vi.mock('@/apis/system/update-settings/fetcher', () => ({
  fetchUpdateSettingsMutation: api.update,
}));
vi.mock('@/apis/resources', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  invalidateResources: api.invalidateResources,
}));

function render<T>(hook: () => T) {
  return renderHook(hook, { wrapper: AllProviders }).result;
}

beforeAll(() => initTestI18n(zhTW));

beforeEach(() => {
  vi.clearAllMocks();
});

describe('useUpdateSettingsMutation', () => {
  it('儲存成功 → 每個改到的鍵各宣告一筆 setting update，並提示', async () => {
    api.update.mockResolvedValue({ items: [] });
    const result = render(() => useUpdateSettingsMutation());
    const variables = {
      params: {
        values: { 'general.siteName': 'Acme', 'general.defaultTimezone': 'Asia/Taipei' },
      } as never,
    };
    act(() => result.current.mutate(variables));

    expect(await screen.findByText('已儲存設定')).toBeInTheDocument();
    expect(api.update.mock.calls[0]![0]).toEqual(variables);
    expect(api.invalidateResources).toHaveBeenCalledTimes(1);
    expect(api.invalidateResources).toHaveBeenCalledWith([
      { resource: 'setting', kind: 'update', id: 'general.siteName' },
      { resource: 'setting', kind: 'update', id: 'general.defaultTimezone' },
    ]);
  });

  it('失敗 → 錯誤交給呼叫端（表單回填）：不失效、不彈 toast', async () => {
    api.update.mockRejectedValue(new AppError('AUTHZ_FORBIDDEN', 403));
    const result = render(() => useUpdateSettingsMutation());
    act(() => result.current.mutate({ params: { values: { 'general.siteName': 'x' } } as never }));

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(api.invalidateResources).not.toHaveBeenCalled();
    expect(screen.queryByText('你沒有執行這個操作的權限。')).not.toBeInTheDocument();
    expect(screen.queryByText('已儲存設定')).not.toBeInTheDocument();
  });
});
