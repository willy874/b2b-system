import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { PermissionKey } from '@/core/permission';
import { resetPagePermissionRegistry } from '@/core/permission';
import { initTestI18n } from '@/test/i18n';
import { renderRoute } from '@/test/renderRoute';

import { registerWebhookPagePermissions, Routes } from '../../..';
import webhookZhTW from '../../../locales/zh_TW.json';

const { fetchWebhooks, deleteWebhook } = vi.hoisted(() => ({
  fetchWebhooks: vi.fn(),
  deleteWebhook: vi.fn(),
}));
vi.mock('@/apis/webhook/get-webhook-list/fetcher', () => ({
  fetchWebhookListQuery: fetchWebhooks,
}));
vi.mock('@/apis/webhook/delete-webhook/fetcher', () => ({
  fetchWebhookDeleteMutation: deleteWebhook,
}));

const webhook = (id: string, name: string) => ({
  id,
  name,
  url: `https://hooks.example.com/${id}`,
  events: ['user.created'],
  status: 'active',
  disabledReason: null,
  consecutiveFailures: 0,
  lastDeliveryAt: null,
  version: 1,
  createdAt: '2026-10-01T00:00:00.000Z',
  updatedAt: '2026-10-01T00:00:00.000Z',
  createdBy: null,
});
const MANAGER = ['webhook:read', 'webhook:create', 'webhook:delete'] as PermissionKey[];
const routes = [Routes.WebhookListRoute];

beforeAll(() => initTestI18n(webhookZhTW));

beforeEach(() => {
  resetPagePermissionRegistry();
  registerWebhookPagePermissions();
  fetchWebhooks.mockReset().mockResolvedValue({
    items: [webhook('w1', 'CI 通知'), webhook('w2', '聊天室')],
    pagination: { offset: 0, limit: 20, total: 2 },
  });
  deleteWebhook.mockReset().mockResolvedValue(undefined);
  vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined);
});

describe('WebhookListPage（docs/adr/0030-webhooks.md W2）', () => {
  it('有 webhook:create／delete → 顯示建立與刪除', async () => {
    renderRoute(routes, '/webhook', MANAGER);
    await screen.findByText('CI 通知', undefined, { timeout: 5000 });
    expect(screen.getByTestId('webhook-create-button')).toBeInTheDocument();
    expect(screen.getAllByTestId('webhook-delete-button')).toHaveLength(2);
  });

  it('只有 webhook:read → 看得到列表，沒有建立與刪除', async () => {
    renderRoute(routes, '/webhook', ['webhook:read'] as PermissionKey[]);
    await screen.findByText('CI 通知', undefined, { timeout: 5000 });
    expect(screen.queryByTestId('webhook-create-button')).toBeNull();
    expect(screen.queryByTestId('webhook-delete-button')).toBeNull();
  });

  it('權限未水合 → 不閃現操作按鈕', async () => {
    renderRoute(routes, '/webhook', 'unhydrated');
    await waitFor(() => expect(screen.queryByTestId('webhook-create-button')).toBeNull());
    expect(screen.queryByTestId('webhook-delete-button')).toBeNull();
  });

  it('刪除：確認後呼叫刪除', async () => {
    renderRoute(routes, '/webhook', MANAGER);
    await screen.findByText('CI 通知', undefined, { timeout: 5000 });
    const row = screen.getByText('CI 通知').closest('tr') as HTMLElement;
    fireEvent.click(within(row).getByTestId('webhook-delete-button'));
    const confirm = await screen.findByTestId('webhook-delete-confirm');
    expect(confirm).toHaveTextContent('不能還原');
    fireEvent.click(within(confirm).getByTestId('alert-dialog-confirm'));
    await waitFor(() => expect(deleteWebhook).toHaveBeenCalledTimes(1));
    expect(deleteWebhook.mock.calls[0]![0]).toMatchObject({ params: { webhookId: 'w1' } });
  });
});
