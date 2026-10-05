import { isVersionConflict, useErrorToast } from '@b2b-system/web-core/errors';
import { useTranslation } from '@b2b-system/web-core/locales';
import { useToast } from '@b2b-system/web-core/notify';
import { useMutation } from '@tanstack/react-query';

import { invalidateResources, Resource } from '@/apis/resources';
import { getWebhookCreateMutationOptions } from '@/apis/webhook/create-webhook/mutation';
import { getWebhookDeleteMutationOptions } from '@/apis/webhook/delete-webhook/mutation';
import { getWebhookRedeliverMutationOptions } from '@/apis/webhook/redeliver-webhook/mutation';
import { getWebhookSecretRotateMutationOptions } from '@/apis/webhook/rotate-webhook-secret/mutation';
import { getWebhookTestSendMutationOptions } from '@/apis/webhook/send-webhook-test/mutation';
import { getWebhookUpdateMutationOptions } from '@/apis/webhook/update-webhook/mutation';
import type { WebhookDelivery, WebhookTestResult } from '@/shared/api-sdk';

/** 建立：錯誤由表單顯示，不彈 toast；回應的密鑰由呼叫端顯示一次。 */
export function useWebhookCreateMutation() {
  return useMutation({
    ...getWebhookCreateMutationOptions(),
    onSuccess: (created) => {
      invalidateResources([{ resource: Resource.WEBHOOK, kind: 'create', id: created.webhook.id }]);
    },
  });
}

/**
 * 改設定、停用、啟用：帶編輯開始時的 `version`（樂觀鎖）。衝突時失效該 webhook 讓畫面拿到最新版本，
 * 訊息交給表單（`VersionConflictAlert`）顯示；其他錯誤（網址不能用）也由表單顯示。
 */
export function useWebhookUpdateMutation() {
  const toast = useToast();
  const { t } = useTranslation();

  return useMutation({
    ...getWebhookUpdateMutationOptions(),
    onSuccess: (webhook) => {
      invalidateResources([{ resource: Resource.WEBHOOK, kind: 'update', id: webhook.id }]);
      toast.success(t('webhook.update.success'));
    },
    onError: (error, { params }) => {
      if (isVersionConflict(error)) {
        invalidateResources([{ resource: Resource.WEBHOOK, kind: 'update', id: params.webhookId }]);
      }
    },
  });
}

/** 硬刪除、不進回收桶：成功的提示沒有「復原」。 */
export function useWebhookDeleteMutation() {
  const toast = useToast();
  const { t } = useTranslation();
  const showError = useErrorToast();

  return useMutation({
    ...getWebhookDeleteMutationOptions(),
    onSuccess: (_, { params }) => {
      invalidateResources([{ resource: Resource.WEBHOOK, kind: 'delete', id: params.webhookId }]);
      toast.success(t('webhook.delete.success'));
    },
    onError: showError,
  });
}

/** 輪替密鑰：新的密鑰由呼叫端顯示一次。 */
export function useWebhookSecretRotateMutation() {
  const showError = useErrorToast();

  return useMutation({
    ...getWebhookSecretRotateMutationOptions(),
    onSuccess: (_, { params }) => {
      invalidateResources([{ resource: Resource.WEBHOOK, kind: 'update', id: params.webhookId }]);
    },
    onError: showError,
  });
}

function deliveryCreated(webhookId: string, delivery: WebhookDelivery) {
  invalidateResources([
    {
      resource: Resource.WEBHOOK_DELIVERY,
      kind: 'create',
      id: delivery.id,
      refs: { [Resource.WEBHOOK]: [webhookId] },
    },
  ]);
}

function useTestSummaryToast() {
  const toast = useToast();
  const { t } = useTranslation();
  return ({ items }: WebhookTestResult) => {
    const failed = items.filter((delivery) => !delivery.succeeded).length;
    if (failed === 0) toast.success(t('webhook.test.sentAll', { count: items.length }));
    else toast.error(t('webhook.test.failedSome', { failed, count: items.length }));
  };
}

/** 送出結果（成功或接收端回錯）都是一筆投遞紀錄：以 toast 說明這一次的結果。 */
function useDeliveryResultToast() {
  const toast = useToast();
  const { t } = useTranslation();
  return (delivery: WebhookDelivery) => {
    if (delivery.succeeded) {
      toast.success(t('webhook.delivery.sent', { status: delivery.responseStatus ?? '' }));
    } else {
      toast.error(
        t('webhook.delivery.failed', {
          reason: delivery.responseStatus
            ? `HTTP ${delivery.responseStatus}`
            : (delivery.error ?? ''),
        }),
      );
    }
  };
}

/**
 * 送測試事件：每個網址各送一次（docs/architecture/backend/17-webhook.md §10.2 D16）。
 * 只有一個網址時沿用單筆的結果提示；多個時提示幾個成功、幾個失敗。
 */
export function useWebhookTestSendMutation() {
  const showResult = useDeliveryResultToast();
  const showSummary = useTestSummaryToast();
  const showError = useErrorToast();

  return useMutation({
    ...getWebhookTestSendMutationOptions(),
    onSuccess: (result, { params }) => {
      for (const delivery of result.items) deliveryCreated(params.webhookId, delivery);
      const [only] = result.items;
      if (result.items.length === 1 && only) showResult(only);
      else showSummary(result);
    },
    onError: showError,
  });
}

export function useWebhookRedeliverMutation() {
  const showResult = useDeliveryResultToast();
  const showError = useErrorToast();

  return useMutation({
    ...getWebhookRedeliverMutationOptions(),
    onSuccess: (delivery, { params }) => {
      deliveryCreated(params.webhookId, delivery);
      showResult(delivery);
    },
    onError: showError,
  });
}
