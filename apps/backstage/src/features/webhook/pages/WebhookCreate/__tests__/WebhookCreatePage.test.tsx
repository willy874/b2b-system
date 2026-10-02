import { fireEvent, screen, waitFor } from '@testing-library/react';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { PermissionKey } from '@/core/permission';
import { resetPagePermissionRegistry } from '@/core/permission';
import { initTestI18n } from '@/test/i18n';
import { renderRoute } from '@/test/renderRoute';

import { registerWebhookPagePermissions, Routes } from '../../..';
import webhookZhTW from '../../../locales/zh_TW.json';

const { fetchList, fetchEvents, createWebhook } = vi.hoisted(() => ({
  fetchList: vi.fn(),
  fetchEvents: vi.fn(),
  createWebhook: vi.fn(),
}));
vi.mock('@/apis/webhook/get-webhook-list/fetcher', () => ({ fetchWebhookListQuery: fetchList }));
vi.mock('@/apis/webhook/get-webhook-events/fetcher', () => ({
  fetchWebhookEventsQuery: fetchEvents,
}));
vi.mock('@/apis/webhook/create-webhook/fetcher', () => ({
  fetchWebhookCreateMutation: createWebhook,
}));

const CREATOR = ['webhook:read', 'webhook:create'] as PermissionKey[];
const routes = [Routes.WebhookListRoute.addChildren([Routes.WebhookCreateRoute])];

beforeAll(() => initTestI18n(webhookZhTW));

beforeEach(() => {
  resetPagePermissionRegistry();
  registerWebhookPagePermissions();
  fetchList
    .mockReset()
    .mockResolvedValue({ items: [], pagination: { offset: 0, limit: 20, total: 0 } });
  fetchEvents.mockReset().mockResolvedValue({ items: [{ type: 'user.created', version: 1 }] });
  createWebhook.mockReset();
  vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined);
});

describe('WebhookCreatePage（docs/architecture/backend/17-webhook.md §9.2 D14）', () => {
  it('還沒選事件時不能送出', async () => {
    renderRoute(routes, '/webhook/create', CREATOR);
    fireEvent.change(
      await screen.findByTestId('webhook-name-input', undefined, { timeout: 5000 }),
      {
        target: { value: 'CI' },
      },
    );
    fireEvent.change(screen.getByTestId('webhook-url-input'), {
      target: { value: 'https://hooks.example.com' },
    });
    expect(screen.getByTestId('webhook-create-submit')).toBeDisabled();
  });

  it('建立成功：同一個對話框改成顯示簽章密鑰一次', async () => {
    createWebhook.mockResolvedValue({
      secret: 'whsec_once',
      webhook: { id: 'w1', name: 'CI' },
    });
    renderRoute(routes, '/webhook/create', CREATOR);
    fireEvent.change(
      await screen.findByTestId('webhook-name-input', undefined, { timeout: 5000 }),
      {
        target: { value: 'CI' },
      },
    );
    fireEvent.change(screen.getByTestId('webhook-url-input'), {
      target: { value: 'https://hooks.example.com' },
    });
    fireEvent.click(screen.getByTestId('webhook-events-select'));
    fireEvent.click(await screen.findByRole('option', { name: /使用者建立/ }));
    fireEvent.click(screen.getByTestId('webhook-create-submit'));

    expect(await screen.findByTestId('webhook-secret-value')).toHaveTextContent('whsec_once');
    expect(createWebhook.mock.calls[0]![0]).toMatchObject({
      params: { name: 'CI', urls: ['https://hooks.example.com'], events: ['user.created'] },
    });
  });

  it('可以加第二個網址；空白列不送出（docs/architecture/backend/17-webhook.md §10.2 D13）', async () => {
    createWebhook.mockResolvedValue({ secret: 'whsec_once', webhook: { id: 'w1', name: 'CI' } });
    renderRoute(routes, '/webhook/create', CREATOR);
    fireEvent.change(
      await screen.findByTestId('webhook-name-input', undefined, { timeout: 5000 }),
      { target: { value: 'CI' } },
    );
    fireEvent.click(screen.getByTestId('webhook-url-add'));
    fireEvent.click(screen.getByTestId('webhook-url-add'));
    const inputs = screen.getAllByTestId('webhook-url-input');
    expect(inputs).toHaveLength(3);
    fireEvent.change(inputs[0]!, { target: { value: 'https://a.example.com' } });
    fireEvent.change(inputs[2]!, { target: { value: ' https://c.example.com ' } });
    fireEvent.click(screen.getByTestId('webhook-events-select'));
    fireEvent.click(await screen.findByRole('option', { name: /使用者建立/ }));
    fireEvent.click(screen.getByTestId('webhook-create-submit'));

    await screen.findByTestId('webhook-secret-value');
    expect(createWebhook.mock.calls[0]![0]).toMatchObject({
      params: { urls: ['https://a.example.com', 'https://c.example.com'] },
    });
  });

  it('沒有 webhook:create → 看不到建立對話框', async () => {
    renderRoute(routes, '/webhook/create', ['webhook:read'] as PermissionKey[]);
    await waitFor(() => expect(screen.queryByTestId('webhook-create-dialog')).toBeNull());
  });
});
