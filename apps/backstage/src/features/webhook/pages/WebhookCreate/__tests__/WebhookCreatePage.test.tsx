import { renderRoute } from '@b2b-system/web-core/testing';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { PermissionKey } from '@/core/permission';
import { resetPagePermissionRegistry } from '@/core/permission';
import { initTestI18n } from '@/test/i18n';

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
// 「完成」導向的詳情：這裡只確認導覽，不渲染真的詳情頁
Routes.WebhookDetailRoute.update({ component: () => <p data-testid="webhook-detail-stub" /> });
const routes = [
  Routes.WebhookListRoute.addChildren([Routes.WebhookCreateRoute, Routes.WebhookDetailRoute]),
];

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

async function typeName() {
  const input = await screen.findByTestId('webhook-name-input', undefined, { timeout: 5000 });
  fireEvent.change(input, { target: { value: 'CI' } });
  return input;
}

async function create() {
  createWebhook.mockResolvedValue({ secret: 'whsec_once', webhook: { id: 'w1', name: 'CI' } });
  await typeName();
  fireEvent.change(screen.getByTestId('webhook-url-input'), {
    target: { value: 'https://hooks.example.com' },
  });
  fireEvent.click(screen.getByTestId('webhook-events-select'));
  fireEvent.click(await screen.findByRole('option', { name: /使用者建立/ }));
  fireEvent.click(screen.getByTestId('webhook-create-submit'));
  await screen.findByTestId('webhook-secret-value');
}

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

  describe('未儲存提醒（docs/architecture/frontend/04-routing.md §2.1）', () => {
    it('填了一半按 Esc：先確認；選「繼續編輯」後對話框與輸入都還在', async () => {
      renderRoute(routes, '/webhook/create', CREATOR);
      const input = await typeName();
      fireEvent.keyDown(input, { key: 'Escape' });

      const confirm = await screen.findByTestId('unsaved-changes-confirm');
      fireEvent.click(within(confirm).getByTestId('alert-dialog-cancel'));
      await waitFor(() => expect(screen.queryByTestId('unsaved-changes-confirm')).toBeNull());
      expect(screen.getByTestId('webhook-create-dialog')).toBeInTheDocument();
      expect(screen.getByTestId('webhook-name-input')).toHaveValue('CI');
    });

    it('填了一半按取消：先確認；選放棄才關閉', async () => {
      renderRoute(routes, '/webhook/create', CREATOR);
      await typeName();
      fireEvent.click(screen.getByTestId('webhook-create-cancel'));

      const confirm = await screen.findByTestId('unsaved-changes-confirm');
      fireEvent.click(within(confirm).getByTestId('alert-dialog-confirm'));
      await waitFor(() => expect(screen.queryByTestId('webhook-create-dialog')).toBeNull());
    });

    it('建立成功後按 Esc：先確認，說明密鑰還沒保存', async () => {
      renderRoute(routes, '/webhook/create', CREATOR);
      await create();
      fireEvent.keyDown(screen.getByTestId('webhook-secret-value'), { key: 'Escape' });

      const confirm = await screen.findByTestId('unsaved-changes-confirm');
      expect(confirm).toHaveTextContent('簽章密鑰保存了嗎？');
      fireEvent.click(within(confirm).getByTestId('alert-dialog-cancel'));
      await waitFor(() => expect(screen.queryByTestId('unsaved-changes-confirm')).toBeNull());
      expect(screen.getByTestId('webhook-secret-value')).toHaveTextContent('whsec_once');
    });

    it('建立成功後按「我已保存密鑰」：不確認，直接到詳情', async () => {
      const { router } = renderRoute(routes, '/webhook/create', CREATOR);
      await create();
      fireEvent.click(screen.getByTestId('webhook-create-done'));

      expect(await screen.findByTestId('webhook-detail-stub')).toBeInTheDocument();
      expect(router.state.location.pathname).toBe('/webhook/w1');
      expect(screen.queryByTestId('unsaved-changes-confirm')).toBeNull();
    });
  });
});
