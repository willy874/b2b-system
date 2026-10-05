import { Button } from '@b2b-system/ui/Button';
import { Chip } from '@b2b-system/ui/Chip';
import { useConfirm } from '@b2b-system/ui/ConfirmDialog';
import { Field } from '@b2b-system/ui/Field';
import { Input } from '@b2b-system/ui/Input';
import { isVersionConflict, useErrorToast } from '@b2b-system/web-core/errors';
import { useTranslation } from '@b2b-system/web-core/locales';
import { useUnsavedChangesGuard } from '@b2b-system/web-core/router';
import { formatDateTime } from '@b2b-system/web-shared/date';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import { getServiceAccountDetailQueryOptions } from '@/apis/service-account/get-service-account-detail/query';
import { VersionConflictAlert } from '@/core/components';
import type { ServiceAccount } from '@/shared/api-sdk';

import { SERVICE_ACCOUNT_STATUS_LABEL_KEY, SERVICE_ACCOUNT_STATUS_TONE } from '../../../constants';
import { useServiceAccountUpdateMutation } from '../../../hooks/useServiceAccountMutations';

interface ServiceAccountBasicSectionProps {
  account: ServiceAccount;
  canEdit: boolean;
}

/**
 * 基本資料：改名（就地編輯）、停用與啟用。送出時帶 `version`（樂觀鎖）。
 * 停用會讓它所有的 token 失效，再啟用也不會回來（docs/architecture/06-external-api.md §9.2 D5）：先確認。
 */
export function ServiceAccountBasicSection({ account, canEdit }: ServiceAccountBasicSectionProps) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const showError = useErrorToast();
  const confirm = useConfirm();
  const update = useServiceAccountUpdateMutation();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState('');
  const [baseVersion, setBaseVersion] = useState(account.version);
  const [reloading, setReloading] = useState(false);
  useUnsavedChangesGuard(editing && name !== account.name);

  const startEditing = (source: ServiceAccount) => {
    setName(source.name);
    setBaseVersion(source.version);
    update.reset();
    setEditing(true);
  };

  /** 衝突後放棄這次的修改：重抓最新的內容與版本，表單改成以它為基礎。 */
  const reload = async () => {
    setReloading(true);
    try {
      startEditing(
        await queryClient.fetchQuery({
          ...getServiceAccountDetailQueryOptions(account.id),
          staleTime: 0,
        }),
      );
    } catch (error) {
      showError(error);
    } finally {
      setReloading(false);
    }
  };

  const save = async () => {
    try {
      await update.mutateAsync({
        params: { serviceAccountId: account.id, body: { name: name.trim(), version: baseVersion } },
      });
    } catch {
      // 錯誤由 mutation 的 onError 顯示；輸入保留，讓使用者修正後重送
      return;
    }
    setEditing(false);
  };

  const toggleStatus = () => {
    const next = account.status === 'active' ? 'inactive' : 'active';
    const run = () =>
      update.mutateAsync({
        params: { serviceAccountId: account.id, body: { status: next, version: account.version } },
      });
    if (next === 'active') {
      void run().catch(() => undefined);
      return;
    }
    void confirm({
      title: t('serviceAccount.deactivate.title'),
      description: t('serviceAccount.deactivate.confirm', {
        name: account.name,
        count: account.activeTokenCount,
      }),
      confirmLabel: t('serviceAccount.deactivate.action'),
      tone: 'danger',
      onConfirm: run,
      'data-testid': 'service-account-deactivate-confirm',
    });
  };

  return (
    <section>
      <div className="flex items-center justify-between">
        <h3 className="m-0 text-sm font-semibold">{t('serviceAccount.detail.basic')}</h3>
        {canEdit && !editing && (
          <div className="flex gap-2">
            <Button
              size="sm"
              onClick={toggleStatus}
              loading={update.isPending}
              data-testid="service-account-status-button"
            >
              {account.status === 'active'
                ? t('serviceAccount.deactivate.action')
                : t('serviceAccount.activate.action')}
            </Button>
            <Button
              size="sm"
              onClick={() => startEditing(account)}
              data-testid="service-account-edit-button"
            >
              {t('common.edit')}
            </Button>
          </div>
        )}
      </div>

      {editing ? (
        <form
          className="mt-2 flex flex-col gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
          data-testid="service-account-edit-form"
        >
          {isVersionConflict(update.error) && (
            <VersionConflictAlert
              error={update.error}
              onReload={() => void reload()}
              reloading={reloading}
            />
          )}
          <Field label={t('serviceAccount.field.name')} required>
            <Input
              value={name}
              maxLength={100}
              onChange={(event) => setName(event.target.value)}
              data-testid="service-account-name-edit-input"
            />
          </Field>
          <div className="flex justify-end gap-2">
            <Button size="sm" onClick={() => setEditing(false)}>
              {t('common.cancel')}
            </Button>
            <Button
              size="sm"
              variant="primary"
              type="submit"
              disabled={!name.trim()}
              loading={update.isPending}
              data-testid="service-account-save-button"
            >
              {t('common.save')}
            </Button>
          </div>
        </form>
      ) : (
        <dl className="mt-2 grid grid-cols-[8rem_1fr] gap-y-2 text-sm">
          <dt className="text-[var(--color-fg-muted)]">{t('serviceAccount.field.status')}</dt>
          <dd className="m-0">
            <Chip
              tone={SERVICE_ACCOUNT_STATUS_TONE[account.status]}
              data-testid="service-account-status"
            >
              {t(SERVICE_ACCOUNT_STATUS_LABEL_KEY[account.status])}
            </Chip>
          </dd>
          <dt className="text-[var(--color-fg-muted)]">{t('serviceAccount.field.createdAt')}</dt>
          <dd className="m-0">{formatDateTime(account.createdAt)}</dd>
        </dl>
      )}
    </section>
  );
}
