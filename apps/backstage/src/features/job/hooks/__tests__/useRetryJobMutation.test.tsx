import { AppError } from '@b2b-system/web-core/errors';
import { AllProviders } from '@b2b-system/web-core/testing';
import { act, renderHook, screen, waitFor } from '@testing-library/react';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { initTestI18n } from '@/test/i18n';

import { useRetryJobMutation } from '../useRetryJobMutation';

const api = vi.hoisted(() => ({ retry: vi.fn(), invalidateResources: vi.fn() }));
vi.mock('@/apis/job/retry-job/fetcher', () => ({ fetchRetryJobMutation: api.retry }));
vi.mock('@/apis/resources', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  invalidateResources: api.invalidateResources,
}));

beforeAll(() => initTestI18n());

beforeEach(() => {
  vi.clearAllMocks();
});

describe('useRetryJobMutation', () => {
  it('重試成功 → 宣告 job update 並提示已重新排入', async () => {
    api.retry.mockResolvedValue({ id: 'j1' });
    const { result } = renderHook(() => useRetryJobMutation(), { wrapper: AllProviders });
    act(() => result.current.mutate({ params: { jobId: 'j1' } as never }));
    expect(await screen.findByText('已重新排入')).toBeInTheDocument();
    expect(api.invalidateResources).toHaveBeenCalledWith([
      { resource: 'job', kind: 'update', id: 'j1' },
    ]);
  });

  it('失敗（例：JOB_NOT_RETRYABLE）→ 不失效，錯誤交給呼叫端', async () => {
    api.retry.mockRejectedValue(new AppError('JOB_NOT_RETRYABLE', 409));
    const { result } = renderHook(() => useRetryJobMutation(), { wrapper: AllProviders });
    act(() => result.current.mutate({ params: { jobId: 'j1' } as never }));
    await waitFor(() => expect(result.current.error).toBeInstanceOf(AppError));
    expect(api.invalidateResources).not.toHaveBeenCalled();
  });
});
