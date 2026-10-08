import { AppError } from '@b2b-system/web-core/errors';
import { renderRoute } from '@b2b-system/web-core/testing';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { PermissionKey } from '@/core/permission';
import { resetPagePermissionRegistry } from '@/core/permission';
import { initTestI18n } from '@/test/i18n';

import { registerWebhookPagePermissions, Routes } from '../../..';
import webhookZhTW from '../../../locales/zh_TW.json';

const {
  fetchList,
  fetchWebhook,
  fetchEvents,
  fetchDeliveries,
  sendTest,
  redeliver,
  rotate,
  update,
} = vi.hoisted(() => ({
  update: vi.fn(),
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
vi.mock('@/apis/webhook/update-webhook/fetcher', () => ({
  fetchWebhookUpdateMutation: update,
}));
vi.mock('@/apis/webhook/rotate-webhook-secret/fetcher', () => ({
  fetchWebhookSecretRotateMutation: rotate,
}));

const WEBHOOK = {
  id: 'w1',
  name: 'CI 通知',
  targets: [
    { id: 't1', url: 'https://hooks.example.com/ci', consecutiveFailures: 0, lastDeliveryAt: null },
  ],
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
  targetId: 't1',
  url: 'https://hooks.example.com/ci',
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
  sendTest.mockReset().mockResolvedValue({
    items: [{ ...DELIVERY, id: 'd2', succeeded: true, responseStatus: 200 }],
  });
  redeliver.mockReset().mockResolvedValue({ ...DELIVERY, id: 'd3', attempt: 2, trigger: 'manual' });
  rotate.mockReset().mockResolvedValue({ secret: 'whsec_new', webhook: WEBHOOK });
  update.mockReset().mockResolvedValue({ ...WEBHOOK, version: 3 });
  vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined);
});

async function openEditor() {
  renderRoute(routes, '/webhook/w1', EDITOR);
  fireEvent.click(await screen.findByTestId('webhook-edit-button', undefined, { timeout: 5000 }));
  return screen.findByTestId('webhook-edit-form');
}

describe('WebhookDetailPage（docs/architecture/backend/17-webhook.md §9 W2）', () => {
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

  it('輪替後按 Esc：新的密鑰仍在畫面上；按「我已保存密鑰」才關閉（舊的已失效，只顯示這一次）', async () => {
    const { router } = renderRoute(routes, '/webhook/w1', EDITOR);
    fireEvent.click(
      await screen.findByTestId('webhook-rotate-button', undefined, { timeout: 5000 }),
    );
    const confirm = await screen.findByTestId('webhook-rotate-confirm');
    fireEvent.click(within(confirm).getByRole('button', { name: '輪替密鑰' }));
    const secret = await screen.findByTestId('webhook-secret-value');

    fireEvent.keyDown(secret, { key: 'Escape' });
    expect(screen.getByTestId('webhook-secret-value')).toHaveTextContent('whsec_new');
    // 外層的詳情對話框也沒有被關掉
    expect(router.state.location.pathname).toBe('/webhook/w1');

    fireEvent.click(screen.getByTestId('webhook-secret-done'));
    await waitFor(() => expect(screen.queryByTestId('webhook-secret-value')).toBeNull());
    expect(router.state.location.pathname).toBe('/webhook/w1');
  });

  it('多個網址：列出每個網址與它的連續失敗次數，投遞紀錄可以依網址篩選（docs/architecture/backend/17-webhook.md §10.2 D15、D16）', async () => {
    fetchWebhook.mockResolvedValue({
      ...WEBHOOK,
      targets: [
        WEBHOOK.targets[0],
        {
          id: 't2',
          url: 'https://second.example.com/hook',
          consecutiveFailures: 3,
          lastDeliveryAt: null,
        },
      ],
    });
    renderRoute(routes, '/webhook/w1', READER);
    await screen.findByTestId('webhook-delivery-view', undefined, { timeout: 5000 });
    expect(screen.getAllByTestId('webhook-detail-url')).toHaveLength(2);
    expect(screen.getByTestId('webhook-detail-url-failures')).toHaveTextContent('3');

    fireEvent.click(screen.getByTestId('webhook-delivery-target-filter'));
    fireEvent.click(await screen.findByRole('option', { name: 'https://second.example.com/hook' }));
    await waitFor(() =>
      expect(fetchDeliveries).toHaveBeenLastCalledWith(
        expect.objectContaining({ params: expect.objectContaining({ targetId: 't2' }) }),
      ),
    );
  });

  describe('設定區塊的編輯與停用（WebhookSettingsSection）', () => {
    it('停用：帶目前的版本送出 status=disabled', async () => {
      renderRoute(routes, '/webhook/w1', EDITOR);
      const button = await screen.findByTestId('webhook-status-button', undefined, {
        timeout: 5000,
      });
      expect(button).toHaveTextContent('停用');
      fireEvent.click(button);
      await waitFor(() => expect(update).toHaveBeenCalledTimes(1));
      expect(update.mock.calls[0]![0]).toMatchObject({
        params: { webhookId: 'w1', body: { status: 'disabled', version: 2 } },
      });
    });

    it('已停用 → 按鈕是啟用，送出 status=active；失敗時以 toast 顯示錯誤', async () => {
      fetchWebhook.mockResolvedValue({ ...WEBHOOK, status: 'disabled', disabledReason: 'manual' });
      update.mockRejectedValue(new AppError('WEBHOOK_VERSION_CONFLICT', 409));
      renderRoute(routes, '/webhook/w1', EDITOR);
      const button = await screen.findByTestId('webhook-status-button', undefined, {
        timeout: 5000,
      });
      expect(button).toHaveTextContent('啟用');
      fireEvent.click(button);
      await waitFor(() =>
        expect(update.mock.calls[0]![0]).toMatchObject({
          params: { body: { status: 'active', version: 2 } },
        }),
      );
      expect(
        await screen.findByText('這個 webhook 已經被其他人修改，請重新載入後再編輯。'),
      ).toBeInTheDocument();
    });

    it('編輯後儲存：送出整理過的名稱、網址、事件與開始編輯時的版本，成功後回到檢視', async () => {
      const form = await openEditor();
      fireEvent.change(within(form).getByTestId('webhook-name-edit-input'), {
        target: { value: '  部署通知  ' },
      });
      fireEvent.click(within(form).getByTestId('webhook-save-button'));

      await waitFor(() => expect(update).toHaveBeenCalledTimes(1));
      expect(update.mock.calls[0]![0]).toMatchObject({
        params: {
          webhookId: 'w1',
          body: {
            name: '部署通知',
            urls: ['https://hooks.example.com/ci'],
            events: ['user.created'],
            version: 2,
          },
        },
      });
      await waitFor(() => expect(screen.queryByTestId('webhook-edit-form')).toBeNull());
    });

    it('名稱清空時不能儲存；取消回到檢視且不送出', async () => {
      const form = await openEditor();
      fireEvent.change(within(form).getByTestId('webhook-name-edit-input'), {
        target: { value: '   ' },
      });
      expect(within(form).getByTestId('webhook-save-button')).toBeDisabled();

      fireEvent.click(within(form).getByRole('button', { name: '取消' }));
      expect(screen.queryByTestId('webhook-edit-form')).toBeNull();
      expect(update).not.toHaveBeenCalled();
    });

    it('儲存失敗（非版本衝突）→ 錯誤顯示在表單上，輸入保留', async () => {
      update.mockRejectedValue(new AppError('WEBHOOK_URL_NOT_ALLOWED', 400));
      const form = await openEditor();
      fireEvent.change(within(form).getByTestId('webhook-name-edit-input'), {
        target: { value: '改過的名稱' },
      });
      fireEvent.click(within(form).getByTestId('webhook-save-button'));

      expect(await within(form).findByText(/這個網址不能使用/)).toBeInTheDocument();
      expect(within(form).getByTestId('webhook-name-edit-input')).toHaveValue('改過的名稱');
    });

    it('版本衝突 → 提示並可重新載入，表單改以最新的內容與版本為基礎', async () => {
      update.mockRejectedValueOnce(new AppError('WEBHOOK_VERSION_CONFLICT', 409));
      const form = await openEditor();
      fireEvent.change(within(form).getByTestId('webhook-name-edit-input'), {
        target: { value: '我的修改' },
      });
      fireEvent.click(within(form).getByTestId('webhook-save-button'));
      await screen.findByTestId('version-conflict-alert');

      fetchWebhook.mockResolvedValue({ ...WEBHOOK, name: '別人的修改', version: 5 });
      fireEvent.click(screen.getByTestId('version-conflict-reload'));
      await waitFor(() =>
        expect(screen.getByTestId('webhook-name-edit-input')).toHaveValue('別人的修改'),
      );
      expect(screen.queryByTestId('version-conflict-alert')).toBeNull();

      fireEvent.click(screen.getByTestId('webhook-save-button'));
      await waitFor(() => expect(update).toHaveBeenCalledTimes(2));
      expect(update.mock.calls[1]![0]).toMatchObject({ params: { body: { version: 5 } } });
    });

    it('重新載入失敗 → 以 toast 顯示錯誤', async () => {
      update.mockRejectedValueOnce(new AppError('WEBHOOK_VERSION_CONFLICT', 409));
      const form = await openEditor();
      fireEvent.click(within(form).getByTestId('webhook-save-button'));
      await screen.findByTestId('version-conflict-alert');

      fetchWebhook.mockRejectedValue(new AppError('WEBHOOK_NOT_FOUND', 404));
      fireEvent.click(screen.getByTestId('version-conflict-reload'));
      expect(await screen.findByText('找不到這個 webhook，可能已被刪除。')).toBeInTheDocument();
    });
  });
});
