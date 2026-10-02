import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { PermissionKey } from '@/core/permission';
import { resetPagePermissionRegistry } from '@/core/permission';
import { initTestI18n } from '@/test/i18n';
import { renderRoute } from '@/test/renderRoute';

import { registerWebhookPagePermissions, Routes } from '../../..';
import webhookZhTW from '../../../locales/zh_TW.json';

const { fetchList, fetchWebhook, fetchEvents, fetchDeliveries, sendTest, redeliver, rotate } =
  vi.hoisted(() => ({
    fetchList: vi.fn(),
    fetchWebhook: vi.fn(),
    fetchEvents: vi.fn(),
    fetchDeliveries: vi.fn(),
    sendTest: vi.fn(),
    redeliver: vi.fn(),
    rotate: vi.fn(),
  }));
vi.mock('@/apis/webhook/get-webhook-list/fetcher', () => ({ fetchWebhookListQuery: fetchList }));
vi.mock('@/apis/webhook/get-webhook-detail/fetcher', () => ({
  fetchWebhookDetailQuery: fetchWebhook,
}));
vi.mock('@/apis/webhook/get-webhook-events/fetcher', () => ({
  fetchWebhookEventsQuery: fetchEvents,
}));
vi.mock('@/apis/webhook/get-webhook-deliveries/fetcher', () => ({
  fetchWebhookDeliveriesQuery: fetchDeliveries,
}));
vi.mock('@/apis/webhook/send-webhook-test/fetcher', () => ({
  fetchWebhookTestSendMutation: sendTest,
}));
vi.mock('@/apis/webhook/redeliver-webhook/fetcher', () => ({
  fetchWebhookRedeliverMutation: redeliver,
}));
vi.mock('@/apis/webhook/rotate-webhook-secret/fetcher', () => ({
  fetchWebhookSecretRotateMutation: rotate,
}));

const WEBHOOK = {
  id: 'w1',
  name: 'CI 通知',
  url: 'https://hooks.example.com/ci',
  events: ['user.created'],
  status: 'active',
  disabledReason: null,
  consecutiveFailures: 0,
  lastDeliveryAt: '2026-10-02T00:00:00.000Z',
  version: 2,
  createdAt: '2026-10-01T00:00:00.000Z',
  updatedAt: '2026-10-01T00:00:00.000Z',
  createdBy: { id: 'u1', displayName: '管理員' },
};
const DELIVERY = {
  id: 'd1',
  eventId: 'e1',
  eventType: 'user.created',
  eventData: { userId: 'u9' },
  occurredAt: '2026-10-02T00:00:00.000Z',
  attempt: 1,
  trigger: 'auto',
  succeeded: false,
  responseStatus: 500,
  durationMs: 120,
  responseBody: 'boom',
  error: null,
  createdAt: '2026-10-02T00:00:00.000Z',
};
const READER = ['webhook:read'] as PermissionKey[];
const EDITOR = ['webhook:read', 'webhook:update'] as PermissionKey[];
const routes = [Routes.WebhookListRoute.addChildren([Routes.WebhookDetailRoute])];

beforeAll(() => initTestI18n(webhookZhTW));

beforeEach(() => {
  resetPagePermissionRegistry();
  registerWebhookPagePermissions();
  fetchList
    .mockReset()
    .mockResolvedValue({ items: [], pagination: { offset: 0, limit: 20, total: 0 } });
  fetchWebhook.mockReset().mockResolvedValue(WEBHOOK);
  fetchEvents.mockReset().mockResolvedValue({ items: [{ type: 'user.created', version: 1 }] });
  fetchDeliveries.mockReset().mockResolvedValue({
    items: [DELIVERY],
    pagination: { offset: 0, limit: 20, total: 1 },
  });
  sendTest
    .mockReset()
    .mockResolvedValue({ ...DELIVERY, id: 'd2', succeeded: true, responseStatus: 200 });
  redeliver.mockReset().mockResolvedValue({ ...DELIVERY, id: 'd3', attempt: 2, trigger: 'manual' });
  rotate.mockReset().mockResolvedValue({ secret: 'whsec_new', webhook: WEBHOOK });
  vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined);
});

describe('WebhookDetailPage（docs/adr/0030-webhooks.md W2）', () => {
  it('有 webhook:update → 顯示送測試事件、輪替密鑰、停用、編輯與重送', async () => {
    renderRoute(routes, '/webhook/w1', EDITOR);
    await screen.findByTestId('webhook-settings-section', undefined, { timeout: 5000 });
    for (const id of [
      'webhook-test-button',
      'webhook-rotate-button',
      'webhook-status-button',
      'webhook-edit-button',
    ]) {
      expect(screen.getByTestId(id)).toBeInTheDocument();
    }
    expect(await screen.findByTestId('webhook-delivery-redeliver')).toBeInTheDocument();
  });

  it('只有 webhook:read → 看得到設定與投遞紀錄，沒有任何操作', async () => {
    renderRoute(routes, '/webhook/w1', READER);
    expect(
      await screen.findByTestId('webhook-detail-url', undefined, { timeout: 5000 }),
    ).toHaveTextContent('https://hooks.example.com/ci');
    await screen.findByTestId('webhook-delivery-view');
    expect(screen.queryByTestId('webhook-test-button')).toBeNull();
    expect(screen.queryByTestId('webhook-edit-button')).toBeNull();
    expect(screen.queryByTestId('webhook-delivery-redeliver')).toBeNull();
  });

  it('權限未水合 → 不閃現操作按鈕', async () => {
    renderRoute(routes, '/webhook/w1', 'unhydrated');
    await waitFor(() => expect(screen.queryByTestId('webhook-test-button')).toBeNull());
    expect(screen.queryByTestId('webhook-edit-button')).toBeNull();
  });

  it('連續失敗而自動停用：說明原因，不能送測試事件或重送', async () => {
    fetchWebhook.mockResolvedValue({
      ...WEBHOOK,
      status: 'disabled',
      disabledReason: 'failing',
      consecutiveFailures: 50,
    });
    renderRoute(routes, '/webhook/w1', EDITOR);
    expect(
      await screen.findByTestId('webhook-failing-notice', undefined, { timeout: 5000 }),
    ).toHaveTextContent('50');
    await screen.findByTestId('webhook-delivery-view');
    expect(screen.queryByTestId('webhook-test-button')).toBeNull();
    expect(screen.queryByTestId('webhook-delivery-redeliver')).toBeNull();
    expect(screen.getByTestId('webhook-status-button')).toHaveTextContent('啟用');
  });

  it('送測試事件與重送都帶上這個 webhook', async () => {
    renderRoute(routes, '/webhook/w1', EDITOR);
    fireEvent.click(await screen.findByTestId('webhook-test-button', undefined, { timeout: 5000 }));
    await waitFor(() => expect(sendTest).toHaveBeenCalledTimes(1));
    expect(sendTest.mock.calls[0]![0]).toMatchObject({ params: { webhookId: 'w1' } });

    fireEvent.click(await screen.findByTestId('webhook-delivery-redeliver'));
    await waitFor(() => expect(redeliver).toHaveBeenCalledTimes(1));
    expect(redeliver.mock.calls[0]![0]).toMatchObject({
      params: { webhookId: 'w1', deliveryId: 'd1' },
    });
  });

  it('輪替密鑰：確認後顯示新的密鑰一次', async () => {
    renderRoute(routes, '/webhook/w1', EDITOR);
    fireEvent.click(
      await screen.findByTestId('webhook-rotate-button', undefined, { timeout: 5000 }),
    );
    const confirm = await screen.findByTestId('webhook-rotate-confirm');
    fireEvent.click(within(confirm).getByRole('button', { name: '輪替密鑰' }));
    expect(await screen.findByTestId('webhook-secret-value')).toHaveTextContent('whsec_new');
  });
});
