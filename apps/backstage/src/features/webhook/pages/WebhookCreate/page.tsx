import { Button } from '@b2b-system/ui/Button';
import { Dialog } from '@b2b-system/ui/Dialog';
import { Field } from '@b2b-system/ui/Field';
import { Input } from '@b2b-system/ui/Input';
import { useErrorMessage } from '@b2b-system/web-core/errors';
import { useTranslation } from '@b2b-system/web-core/locales';
import { useUnsavedChangesGuard } from '@b2b-system/web-core/router';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { useId, useState } from 'react';

import { getWebhookEventsQueryOptions } from '@/apis/webhook/get-webhook-events/query';
import type { CreatedWebhook } from '@/shared/api-sdk';

import { WebhookEventSelect } from '../../components/WebhookEventSelect';
import { WebhookSecretNotice } from '../../components/WebhookSecretNotice';
import { WebhookUrlsInput } from '../../components/WebhookUrlsInput';
import { useWebhookCreateMutation } from '../../hooks/useWebhookMutations';
import { WebhookCreateRoute, WebhookDetailRoute, WebhookListRoute } from '../../routes';
import { cleanUrls } from '../../utils';

/**
 * 建立 webhook：名稱、網址（1～10 個，docs/architecture/backend/17-webhook.md §10.2 D13）、訂閱的事件。成功後同一個對話框改成顯示簽章密鑰——**只出現這一次**
 * （docs/architecture/backend/17-webhook.md §9.2 D14）。
 */
export default function WebhookCreatePage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const search = WebhookCreateRoute.useSearch();
  const createWebhook = useWebhookCreateMutation();
  const toMessage = useErrorMessage();
  const events = useQuery(getWebhookEventsQueryOptions());
  const formId = useId();
  const [name, setName] = useState('');
  const [urls, setUrls] = useState<string[]>(['']);
  const [selected, setSelected] = useState<string[]>([]);
  const [formError, setFormError] = useState<string>();
  const [created, setCreated] = useState<CreatedWebhook>();
  // 密鑰顯示中也要擋：關掉就再也看不到，所以確認框改說明密鑰還沒保存
  useUnsavedChangesGuard(
    Boolean(created) || Boolean(name) || cleanUrls(urls).length > 0 || selected.length > 0,
    created
      ? {
          title: t('webhook.create.secretUnsaved.title'),
          description: t('webhook.create.secretUnsaved.description'),
          confirmLabel: t('webhook.create.secretUnsaved.leave'),
          cancelLabel: t('webhook.create.secretUnsaved.stay'),
        }
      : undefined,
  );

  // 取消、Esc、點遮罩都會被 guard 攔下；只有建立成功後按「完成」（openDetail）才略過
  const close = () => void navigate({ to: WebhookListRoute.to, search });
  const openDetail = (id: string) =>
    void navigate({
      to: WebhookDetailRoute.to,
      params: { webhookId: id },
      search,
      ignoreBlocker: true,
    });

  const submit = async () => {
    setFormError(undefined);
    try {
      setCreated(
        await createWebhook.mutateAsync({
          params: { name: name.trim(), urls: cleanUrls(urls), events: selected },
        }),
      );
    } catch (error) {
      setFormError(toMessage(error));
    }
  };

  return (
    <Dialog
      open
      onOpenChange={(open) => !open && close()}
      // 密鑰只出現這一次：顯示中 Esc、點遮罩不關閉，只能按「我已保存密鑰」
      dismissible={!created}
      title={created ? t('webhook.create.createdTitle') : t('webhook.create.title')}
      description={created ? undefined : t('webhook.create.description')}
      size="md"
      data-testid="webhook-create-dialog"
      footer={
        created ? (
          <Button
            variant="primary"
            onClick={() => openDetail(created.webhook.id)}
            data-testid="webhook-create-done"
          >
            {t('webhook.create.done')}
          </Button>
        ) : (
          <>
            <Button onClick={close} data-testid="webhook-create-cancel">
              {t('common.cancel')}
            </Button>
            <Button
              variant="primary"
              type="submit"
              form={formId}
              disabled={!name.trim() || cleanUrls(urls).length === 0 || selected.length === 0}
              loading={createWebhook.isPending}
              data-testid="webhook-create-submit"
            >
              {t('common.create')}
            </Button>
          </>
        )
      }
    >
      {created ? (
        <WebhookSecretNotice secret={created.secret} />
      ) : (
        <form
          id={formId}
          className="flex flex-col gap-4"
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <Field label={t('webhook.field.name')} required>
            <Input
              value={name}
              maxLength={100}
              onChange={(event) => setName(event.target.value)}
              data-testid="webhook-name-input"
            />
          </Field>
          <Field label={t('webhook.field.urls')} description={t('webhook.field.urlHint')} required>
            <WebhookUrlsInput value={urls} onValueChange={setUrls} data-testid="webhook-urls" />
          </Field>
          <Field label={t('webhook.field.events')} required>
            <WebhookEventSelect
              events={events.data?.items}
              value={selected}
              onValueChange={setSelected}
              aria-label={t('webhook.field.events')}
              data-testid="webhook-events-select"
            />
          </Field>
          {/* role="alert"：送出失敗時報讀器會立即念出 */}
          <p role="alert" className="m-0 text-sm text-[var(--color-danger-text)] empty:hidden">
            {formError}
          </p>
        </form>
      )}
    </Dialog>
  );
}
