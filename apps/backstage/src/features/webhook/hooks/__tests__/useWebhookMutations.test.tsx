import { AppError } from '@b2b-system/web-core/errors';
import { AllProviders } from '@b2b-system/web-core/testing';
import { act, renderHook, screen, waitFor } from '@testing-library/react';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { initTestI18n } from '@/test/i18n';

import zhTW from '../../locales/zh_TW.json';
import {
  useWebhookCreateMutation,
  useWebhookDeleteMutation,
  useWebhookRedeliverMutation,
  useWebhookSecretRotateMutation,
  useWebhookTestSendMutation,
  useWebhookUpdateMutation,
} from '../useWebhookMutations';

const api = vi.hoisted(() => ({
  create: vi.fn(),
  update: vi.fn(),
  remove: vi.fn(),
  rotate: vi.fn(),
  test: vi.fn(),
  redeliver: vi.fn(),
  invalidateResources: vi.fn(),
}));
vi.mock('@/apis/webhook/create-webhook/fetcher', () => ({
  fetchWebhookCreateMutation: api.create,
}));
vi.mock('@/apis/webhook/update-webhook/fetcher', () => ({
  fetchWebhookUpdateMutation: api.update,
}));
vi.mock('@/apis/webhook/delete-webhook/fetcher', () => ({
  fetchWebhookDeleteMutation: api.remove,
}));
vi.mock('@/apis/webhook/rotate-webhook-secret/fetcher', () => ({
  fetchWebhookSecretRotateMutation: api.rotate,
}));
vi.mock('@/apis/webhook/send-webhook-test/fetcher', () => ({
  fetchWebhookTestSendMutation: api.test,
}));
vi.mock('@/apis/webhook/redeliver-webhook/fetcher', () => ({
  fetchWebhookRedeliverMutation: api.redeliver,
}));
vi.mock('@/apis/resources', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  invalidateResources: api.invalidateResources,
}));

const UPDATED = [{ resource: 'webhook', kind: 'update', id: 'w1' }];
const FORBIDDEN = new AppError('AUTHZ_FORBIDDEN', 403);
const FORBIDDEN_MESSAGE = '你沒有執行這個操作的權限。';

function delivery(id: string, overrides: Record<string, unknown> = {}) {
  return { id, succeeded: true, responseStatus: 200, error: null, ...overrides };
}

function deliveryCreated(id: string) {
  return [{ resource: 'webhookDelivery', kind: 'create', id, refs: { webhook: ['w1'] } }];
}

function render<T>(hook: () => T) {
  return renderHook(hook, { wrapper: AllProviders }).result;
}

beforeAll(() => initTestI18n(zhTW));

beforeEach(() => {
  vi.clearAllMocks();
});

describe('useWebhookCreateMutation', () => {
  it('建立成功 → 宣告 webhook create，不彈 toast', async () => {
    api.create.mockResolvedValue({ webhook: { id: 'w1' }, secret: 's' });
    const result = render(() => useWebhookCreateMutation());
    act(() => result.current.mutate({ params: {} as never }));
    await waitFor(() =>
      expect(api.invalidateResources).toHaveBeenCalledWith([
        { resource: 'webhook', kind: 'create', id: 'w1' },
      ]),
    );
  });
});

describe('useWebhookUpdateMutation', () => {
  it('更新成功 → 宣告 webhook update 並提示', async () => {
    api.update.mockResolvedValue({ id: 'w1' });
    const result = render(() => useWebhookUpdateMutation());
    act(() => result.current.mutate({ params: { webhookId: 'w1' } as never }));
    expect(await screen.findByText('已更新 Webhook')).toBeInTheDocument();
    expect(api.invalidateResources).toHaveBeenCalledWith(UPDATED);
  });

  it('版本衝突 → 失效該 webhook，不彈 toast', async () => {
    api.update.mockRejectedValue(new AppError('WEBHOOK_VERSION_CONFLICT', 409));
    const result = render(() => useWebhookUpdateMutation());
    act(() => result.current.mutate({ params: { webhookId: 'w1' } as never }));
    await waitFor(() => expect(api.invalidateResources).toHaveBeenCalledWith(UPDATED));
    expect(
      screen.queryByText('這個 webhook 已經被其他人修改，請重新載入後再編輯。'),
    ).not.toBeInTheDocument();
  });

  it('其他錯誤（網址不能用）→ 不失效，交給表單', async () => {
    api.update.mockRejectedValue(FORBIDDEN);
    const result = render(() => useWebhookUpdateMutation());
    act(() => result.current.mutate({ params: { webhookId: 'w1' } as never }));
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(api.invalidateResources).not.toHaveBeenCalled();
  });
});

describe('useWebhookDeleteMutation', () => {
  it('刪除成功 → 宣告 webhook delete 並提示', async () => {
    api.remove.mockResolvedValue(undefined);
    const result = render(() => useWebhookDeleteMutation());
    act(() => result.current.mutate({ params: { webhookId: 'w1' } }));
    expect(await screen.findByText('已刪除 Webhook')).toBeInTheDocument();
    expect(api.invalidateResources).toHaveBeenCalledWith([
      { resource: 'webhook', kind: 'delete', id: 'w1' },
    ]);
  });

  it('失敗 → 以 toast 顯示錯誤', async () => {
    api.remove.mockRejectedValue(FORBIDDEN);
    const result = render(() => useWebhookDeleteMutation());
    act(() => result.current.mutate({ params: { webhookId: 'w1' } }));
    expect(await screen.findByText(FORBIDDEN_MESSAGE)).toBeInTheDocument();
  });
});

describe('useWebhookSecretRotateMutation', () => {
  it('輪替成功 → 宣告 webhook update', async () => {
    api.rotate.mockResolvedValue({ secret: 'new' });
    const result = render(() => useWebhookSecretRotateMutation());
    act(() => result.current.mutate({ params: { webhookId: 'w1' } as never }));
    await waitFor(() => expect(api.invalidateResources).toHaveBeenCalledWith(UPDATED));
  });

  it('失敗 → 以 toast 顯示錯誤', async () => {
    api.rotate.mockRejectedValue(FORBIDDEN);
    const result = render(() => useWebhookSecretRotateMutation());
    act(() => result.current.mutate({ params: { webhookId: 'w1' } as never }));
    expect(await screen.findByText(FORBIDDEN_MESSAGE)).toBeInTheDocument();
  });
});

describe('useWebhookTestSendMutation', () => {
  it('只有一個網址且成功 → 每筆投遞宣告 create，提示接收端的狀態碼', async () => {
    api.test.mockResolvedValue({ items: [delivery('d1', { responseStatus: 204 })] });
    const result = render(() => useWebhookTestSendMutation());
    act(() => result.current.mutate({ params: { webhookId: 'w1' } as never }));
    expect(await screen.findByText('已送出，接收端回應 204')).toBeInTheDocument();
    expect(api.invalidateResources).toHaveBeenCalledWith(deliveryCreated('d1'));
  });

  it('只有一個網址且接收端回 5xx → 提示 HTTP 狀態碼', async () => {
    api.test.mockResolvedValue({
      items: [delivery('d1', { succeeded: false, responseStatus: 503 })],
    });
    const result = render(() => useWebhookTestSendMutation());
    act(() => result.current.mutate({ params: { webhookId: 'w1' } as never }));
    expect(await screen.findByText('送出失敗：HTTP 503')).toBeInTheDocument();
  });

  it('連線失敗沒有狀態碼 → 提示錯誤原因', async () => {
    api.test.mockResolvedValue({
      items: [delivery('d1', { succeeded: false, responseStatus: null, error: 'ECONNREFUSED' })],
    });
    const result = render(() => useWebhookTestSendMutation());
    act(() => result.current.mutate({ params: { webhookId: 'w1' } as never }));
    expect(await screen.findByText('送出失敗：ECONNREFUSED')).toBeInTheDocument();
  });

  it('多個網址全部成功 → 提示全部成功的數量', async () => {
    api.test.mockResolvedValue({ items: [delivery('d1'), delivery('d2')] });
    const result = render(() => useWebhookTestSendMutation());
    act(() => result.current.mutate({ params: { webhookId: 'w1' } as never }));
    expect(await screen.findByText('已送到 2 個網址，全部成功')).toBeInTheDocument();
    expect(api.invalidateResources).toHaveBeenCalledWith(deliveryCreated('d1'));
    expect(api.invalidateResources).toHaveBeenCalledWith(deliveryCreated('d2'));
  });

  it('多個網址部分失敗 → 提示失敗幾個', async () => {
    api.test.mockResolvedValue({
      items: [delivery('d1'), delivery('d2', { succeeded: false }), delivery('d3')],
    });
    const result = render(() => useWebhookTestSendMutation());
    act(() => result.current.mutate({ params: { webhookId: 'w1' } as never }));
    expect(
      await screen.findByText('3 個網址中有 1 個送出失敗，詳情見投遞紀錄'),
    ).toBeInTheDocument();
  });

  it('失敗 → 以 toast 顯示錯誤', async () => {
    api.test.mockRejectedValue(FORBIDDEN);
    const result = render(() => useWebhookTestSendMutation());
    act(() => result.current.mutate({ params: { webhookId: 'w1' } as never }));
    expect(await screen.findByText(FORBIDDEN_MESSAGE)).toBeInTheDocument();
  });
});

describe('useWebhookRedeliverMutation', () => {
  it('重送成功 → 宣告投遞 create 並提示結果', async () => {
    api.redeliver.mockResolvedValue(delivery('d9'));
    const result = render(() => useWebhookRedeliverMutation());
    act(() => result.current.mutate({ params: { webhookId: 'w1', deliveryId: 'd1' } as never }));
    expect(await screen.findByText('已送出，接收端回應 200')).toBeInTheDocument();
    expect(api.invalidateResources).toHaveBeenCalledWith(deliveryCreated('d9'));
  });

  it('失敗 → 以 toast 顯示錯誤', async () => {
    api.redeliver.mockRejectedValue(FORBIDDEN);
    const result = render(() => useWebhookRedeliverMutation());
    act(() => result.current.mutate({ params: { webhookId: 'w1', deliveryId: 'd1' } as never }));
    expect(await screen.findByText(FORBIDDEN_MESSAGE)).toBeInTheDocument();
  });
});
