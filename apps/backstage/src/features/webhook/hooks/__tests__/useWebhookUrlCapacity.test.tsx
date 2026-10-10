import { AllProviders } from '@b2b-system/web-core/testing';
import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { WEBHOOK_MAX_URLS_PER_SUBSCRIPTION } from '../../constants';
import { useWebhookUrlCapacity } from '../useWebhookUrlCapacity';

const fetchLimit = vi.hoisted(() => vi.fn());
vi.mock('@/apis/webhook/get-webhook-url-limit/fetcher', () => ({
  fetchWebhookUrlLimitQuery: fetchLimit,
}));

function render(subscriptionId?: string) {
  return renderHook(() => useWebhookUrlCapacity(subscriptionId), { wrapper: AllProviders }).result;
}

beforeEach(() => {
  fetchLimit.mockReset();
});

describe('useWebhookUrlCapacity（docs/architecture/05-tenancy.md §15.2 D5）', () => {
  it('額度還沒取得 → undefined（表單先不顯示「新增網址」）', () => {
    fetchLimit.mockReturnValue(new Promise(() => {}));
    expect(render('s1').current).toBeUndefined();
  });

  it('租戶額度比每個訂閱的上限小 → 取租戶額度', async () => {
    fetchLimit.mockResolvedValue({ available: 3 });
    const result = render('s1');
    await waitFor(() => expect(result.current).toBe(3));
    expect(fetchLimit.mock.calls[0]![0].params).toEqual({ subscriptionId: 's1' });
  });

  it('租戶額度比每個訂閱的上限大 → 取每個訂閱的上限', async () => {
    fetchLimit.mockResolvedValue({ available: WEBHOOK_MAX_URLS_PER_SUBSCRIPTION + 5 });
    const result = render('s1');
    await waitFor(() => expect(result.current).toBe(WEBHOOK_MAX_URLS_PER_SUBSCRIPTION));
  });

  it('建立新訂閱（沒有 id）→ 不帶 subscriptionId 查詢；額度用完是 0', async () => {
    fetchLimit.mockResolvedValue({ available: 0 });
    const result = render();
    await waitFor(() => expect(result.current).toBe(0));
    expect(fetchLimit.mock.calls[0]![0].params).toEqual({});
  });
});
