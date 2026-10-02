import { useQuery } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';

import { getWebhookDetailQueryOptions } from '@/apis/webhook/get-webhook-detail/query';
import { Button } from '@/components/Button';
import { Dialog } from '@/components/Dialog';
import { Skeleton } from '@/components/Skeleton';
import { QueryError } from '@/core/components';
import { isNotFound } from '@/core/errors';
import { useTranslation } from '@/core/locales';

import { useWebhookPermission } from '../../hooks/useWebhookPermission';
import { WebhookDetailRoute, WebhookListRoute } from '../../routes';
import { WebhookDeliverySection } from './components/WebhookDeliverySection';
import { WebhookSettingsSection } from './components/WebhookSettingsSection';

/** Webhook 詳情：設定（編輯、停用與啟用、輪替密鑰、送測試事件）與投遞紀錄（重送）。 */
export default function WebhookDetailPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { webhookId } = WebhookDetailRoute.useParams();
  const search = WebhookListRoute.useSearch();
  const permission = useWebhookPermission();
  const webhook = useQuery(getWebhookDetailQueryOptions(webhookId));

  const close = () => void navigate({ to: WebhookListRoute.to, search });

  return (
    <Dialog
      open
      onOpenChange={(open) => !open && close()}
      title={webhook.data?.name ?? t('webhook.detail.title')}
      size="lg"
      data-testid="webhook-detail-dialog"
      footer={
        <Button variant="primary" onClick={close}>
          {t('common.close')}
        </Button>
      }
    >
      {webhook.isPending && <Skeleton height={160} />}
      {/* 深層連結（例：站內通知）指向已刪除的 webhook：說明原因並提供返回 */}
      {webhook.isError && (
        <QueryError
          error={webhook.error}
          onRetry={isNotFound(webhook.error) ? undefined : () => void webhook.refetch()}
          action={
            <Button onClick={close} data-testid="webhook-detail-back">
              {t('webhook.detail.backToList')}
            </Button>
          }
          data-testid="webhook-detail-error"
        />
      )}
      {webhook.data && (
        <div className="flex flex-col gap-5">
          <WebhookSettingsSection
            webhook={webhook.data}
            canEdit={permission.canUpdate}
            canSend={permission.canSend}
          />
          <WebhookDeliverySection
            webhookId={webhookId}
            targets={webhook.data.targets}
            canRedeliver={permission.canSend && webhook.data.status === 'active'}
          />
        </div>
      )}
    </Dialog>
  );
}
