import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import { getWebhookDetailQueryOptions } from '@/apis/webhook/get-webhook-detail/query';
import { getWebhookEventsQueryOptions } from '@/apis/webhook/get-webhook-events/query';
import { Button } from '@/components/Button';
import { Chip } from '@/components/Chip';
import { useConfirm } from '@/components/ConfirmDialog';
import { Dialog } from '@/components/Dialog';
import { Field } from '@/components/Field';
import { Input } from '@/components/Input';
import { VersionConflictAlert } from '@/core/components';
import { isVersionConflict, useErrorMessage, useErrorToast } from '@/core/errors';
import { useTranslation } from '@/core/locales';
import { useUnsavedChangesGuard } from '@/core/router';
import type { Webhook } from '@/shared/api-sdk';
import { formatDateTime } from '@/shared/date';

import { WebhookEventSelect } from '../../../components/WebhookEventSelect';
import { WebhookSecretNotice } from '../../../components/WebhookSecretNotice';
import {
  WEBHOOK_AUTO_DISABLE_AFTER_FAILURES,
  WEBHOOK_DISABLED_REASON_KEY,
  WEBHOOK_EVENT_LABEL,
  WEBHOOK_STATUS_LABEL_KEY,
  WEBHOOK_STATUS_TONE,
} from '../../../constants';
import {
  useWebhookSecretRotateMutation,
  useWebhookTestSendMutation,
  useWebhookUpdateMutation,
} from '../../../hooks/useWebhookMutations';

interface WebhookSettingsSectionProps {
  webhook: Webhook;
  canEdit: boolean;
  canSend: boolean;
}

interface Draft {
  name: string;
  url: string;
  events: string[];
  version: number;
}

function draftOf(webhook: Webhook): Draft {
  return { name: webhook.name, url: webhook.url, events: webhook.events, version: webhook.version };
}

/**
 * 設定：名稱、網址、事件（就地編輯，帶 `version` 樂觀鎖）；停用與啟用（啟用時失敗次數歸零）；
 * 輪替密鑰（舊的立即失效，先確認）；送測試事件（docs/adr/0030-webhooks.md D13、D14、D17）。
 */
export function WebhookSettingsSection({ webhook, canEdit, canSend }: WebhookSettingsSectionProps) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const showError = useErrorToast();
  const toMessage = useErrorMessage();
  const confirm = useConfirm();
  const update = useWebhookUpdateMutation();
  const rotate = useWebhookSecretRotateMutation();
  const sendTest = useWebhookTestSendMutation();
  const events = useQuery({ ...getWebhookEventsQueryOptions(), enabled: canEdit });
  const [draft, setDraft] = useState<Draft>();
  const [reloading, setReloading] = useState(false);
  const [secret, setSecret] = useState<string>();
  const dirty =
    draft !== undefined &&
    (draft.name !== webhook.name ||
      draft.url !== webhook.url ||
      draft.events.join(',') !== webhook.events.join(','));
  useUnsavedChangesGuard(dirty);

  const startEditing = (source: Webhook) => {
    update.reset();
    setDraft(draftOf(source));
  };

  /** 衝突後放棄這次的修改：重抓最新的內容與版本，表單改成以它為基礎。 */
  const reload = async () => {
    setReloading(true);
    try {
      startEditing(
        await queryClient.fetchQuery({ ...getWebhookDetailQueryOptions(webhook.id), staleTime: 0 }),
      );
    } catch (error) {
      showError(error);
    } finally {
      setReloading(false);
    }
  };

  const save = async () => {
    if (!draft) return;
    try {
      await update.mutateAsync({
        params: {
          webhookId: webhook.id,
          body: {
            name: draft.name.trim(),
            url: draft.url.trim(),
            events: draft.events,
            version: draft.version,
          },
        },
      });
    } catch {
      // 錯誤顯示在表單上；輸入保留，讓使用者修正後重送
      return;
    }
    setDraft(undefined);
  };

  const toggleStatus = () => {
    const status = webhook.status === 'active' ? 'disabled' : 'active';
    void update
      .mutateAsync({
        params: { webhookId: webhook.id, body: { status, version: webhook.version } },
      })
      .catch(showError);
  };

  const rotateSecret = () =>
    void confirm({
      title: t('webhook.secret.rotateTitle'),
      description: t('webhook.secret.rotateConfirm', { name: webhook.name }),
      confirmLabel: t('webhook.secret.rotate'),
      tone: 'danger',
      onConfirm: async () => {
        const result = await rotate.mutateAsync({ params: { webhookId: webhook.id } });
        setSecret(result.secret);
      },
      'data-testid': 'webhook-rotate-confirm',
    });

  const formError =
    update.error && !isVersionConflict(update.error) ? toMessage(update.error) : undefined;

  return (
    <section data-testid="webhook-settings-section">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="m-0 text-sm font-semibold">{t('webhook.detail.settings')}</h3>
        {!draft && (
          <div className="flex flex-wrap gap-2">
            {canSend && webhook.status === 'active' && (
              <Button
                size="sm"
                onClick={() => void sendTest.mutateAsync({ params: { webhookId: webhook.id } })}
                loading={sendTest.isPending}
                data-testid="webhook-test-button"
              >
                {t('webhook.test.action')}
              </Button>
            )}
            {canEdit && (
              <>
                <Button
                  size="sm"
                  onClick={rotateSecret}
                  loading={rotate.isPending}
                  data-testid="webhook-rotate-button"
                >
                  {t('webhook.secret.rotate')}
                </Button>
                <Button
                  size="sm"
                  onClick={toggleStatus}
                  loading={update.isPending}
                  data-testid="webhook-status-button"
                >
                  {webhook.status === 'active'
                    ? t('webhook.disable.action')
                    : t('webhook.enable.action')}
                </Button>
                <Button
                  size="sm"
                  onClick={() => startEditing(webhook)}
                  data-testid="webhook-edit-button"
                >
                  {t('common.edit')}
                </Button>
              </>
            )}
          </div>
        )}
      </div>

      {webhook.disabledReason === 'failing' && !draft && (
        <p
          className="mt-2 mb-0 text-sm text-[var(--color-warning-text)]"
          data-testid="webhook-failing-notice"
        >
          {t('webhook.detail.failingNotice', { count: WEBHOOK_AUTO_DISABLE_AFTER_FAILURES })}
        </p>
      )}

      {draft ? (
        <form
          className="mt-2 flex flex-col gap-3"
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
          data-testid="webhook-edit-form"
        >
          {isVersionConflict(update.error) && (
            <VersionConflictAlert
              error={update.error}
              onReload={() => void reload()}
              reloading={reloading}
            />
          )}
          <Field label={t('webhook.field.name')} required>
            <Input
              value={draft.name}
              maxLength={100}
              onChange={(event) => setDraft({ ...draft, name: event.target.value })}
              data-testid="webhook-name-edit-input"
            />
          </Field>
          <Field label={t('webhook.field.url')} description={t('webhook.field.urlHint')} required>
            <Input
              type="url"
              value={draft.url}
              maxLength={2000}
              onChange={(event) => setDraft({ ...draft, url: event.target.value })}
              data-testid="webhook-url-edit-input"
            />
          </Field>
          <Field label={t('webhook.field.events')} required>
            <WebhookEventSelect
              events={events.data?.items}
              value={draft.events}
              onValueChange={(next) => setDraft({ ...draft, events: next })}
              aria-label={t('webhook.field.events')}
              data-testid="webhook-events-edit-select"
            />
          </Field>
          <p role="alert" className="m-0 text-sm text-[var(--color-danger-text)] empty:hidden">
            {formError}
          </p>
          <div className="flex justify-end gap-2">
            <Button size="sm" onClick={() => setDraft(undefined)}>
              {t('common.cancel')}
            </Button>
            <Button
              size="sm"
              variant="primary"
              type="submit"
              disabled={!draft.name.trim() || !draft.url.trim() || draft.events.length === 0}
              loading={update.isPending}
              data-testid="webhook-save-button"
            >
              {t('common.save')}
            </Button>
          </div>
        </form>
      ) : (
        <dl className="mt-2 grid grid-cols-[8rem_1fr] gap-y-2 text-sm">
          <dt className="text-[var(--color-fg-muted)]">{t('webhook.field.status')}</dt>
          <dd className="m-0 flex items-center gap-2">
            <Chip tone={WEBHOOK_STATUS_TONE[webhook.status]} data-testid="webhook-detail-status">
              {t(WEBHOOK_STATUS_LABEL_KEY[webhook.status])}
            </Chip>
            {webhook.disabledReason && (
              <span className="text-[var(--color-fg-muted)]">
                {t(WEBHOOK_DISABLED_REASON_KEY[webhook.disabledReason])}
              </span>
            )}
          </dd>
          <dt className="text-[var(--color-fg-muted)]">{t('webhook.field.url')}</dt>
          <dd className="m-0 break-all" data-testid="webhook-detail-url">
            {webhook.url}
          </dd>
          <dt className="text-[var(--color-fg-muted)]">{t('webhook.field.events')}</dt>
          <dd className="m-0 flex flex-wrap gap-1">
            {webhook.events.map((type) => {
              const label = WEBHOOK_EVENT_LABEL[type];
              return (
                <Chip key={type} data-testid="webhook-detail-event" data-value={type}>
                  {label ? t(label.nameKey) : type}
                </Chip>
              );
            })}
          </dd>
          <dt className="text-[var(--color-fg-muted)]">{t('webhook.field.consecutiveFailures')}</dt>
          <dd className="m-0">{webhook.consecutiveFailures}</dd>
          <dt className="text-[var(--color-fg-muted)]">{t('webhook.field.lastDeliveryAt')}</dt>
          <dd className="m-0">
            {webhook.lastDeliveryAt ? formatDateTime(webhook.lastDeliveryAt) : '-'}
          </dd>
          <dt className="text-[var(--color-fg-muted)]">{t('webhook.field.createdBy')}</dt>
          <dd className="m-0">
            {webhook.createdBy?.displayName ?? '-'}（{formatDateTime(webhook.createdAt)}）
          </dd>
        </dl>
      )}

      <Dialog
        open={Boolean(secret)}
        onOpenChange={(open) => !open && setSecret(undefined)}
        title={t('webhook.secret.rotatedTitle')}
        size="md"
        footer={
          <Button
            variant="primary"
            onClick={() => setSecret(undefined)}
            data-testid="webhook-secret-done"
          >
            {t('common.close')}
          </Button>
        }
        data-testid="webhook-secret-dialog"
      >
        {secret && <WebhookSecretNotice secret={secret} />}
      </Dialog>
    </section>
  );
}
