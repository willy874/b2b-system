import { Button } from '@b2b-system/ui/Button';
import { Skeleton } from '@b2b-system/ui/Skeleton';
import { QueryError } from '@b2b-system/web-core/components';
import { useErrorToast } from '@b2b-system/web-core/errors';
import { useTranslation } from '@b2b-system/web-core/locales';
import { useUnsavedChangesGuard } from '@b2b-system/web-core/router';
import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';

import { getNotificationEventListQueryOptions } from '@/apis/notification/get-notification-event-list/query';
import { SystemSettingsLayout } from '@/core/system-settings';

import { useNotificationEventDraft } from '../../hooks/useNotificationEventDraft';
import { useNotificationEventPermission } from '../../hooks/useNotificationEventPermission';
import { useUpdateNotificationEventsMutation } from '../../hooks/useUpdateNotificationEventsMutation';
import { toNotificationEventCategories } from './adapter';
import { NotificationEventRow } from './components/NotificationEventRow';

/**
 * 事件管理（docs/architecture/frontend/15-notification.md §9、docs/architecture/backend/16-notification-event.md §9.2 D12）：
 * 依分類列出系統會發出的事件，租戶決定每個管道是否送出；沒有 `system:update` 時唯讀。系統設定的「事件通知」分頁。
 */
export default function NotificationEventListPage() {
  const { t } = useTranslation();
  const permission = useNotificationEventPermission();
  const {
    data,
    isPending,
    error: loadError,
    refetch,
  } = useQuery(getNotificationEventListQueryOptions());
  const categories = useMemo(() => toNotificationEventCategories(data?.items ?? []), [data]);
  const draft = useNotificationEventDraft();
  const update = useUpdateNotificationEventsMutation();
  const showError = useErrorToast();
  // 權限未水合前一律唯讀，避免開關先可切換再變成停用
  const canUpdate = permission.hydrated && permission.canUpdate;
  // 常一次改好幾項：有未儲存的修改時換頁先確認
  useUnsavedChangesGuard(draft.isDirty);

  const save = async () => {
    try {
      await update.mutateAsync({ params: { changes: draft.changes } });
      draft.clear();
    } catch (error) {
      showError(error);
    }
  };

  return (
    <SystemSettingsLayout>
      <div className="flex max-w-4xl flex-col gap-4" data-testid="notification-event-page">
        <p className="m-0 text-sm text-[var(--color-fg-muted)]">
          {t('notification.event.description')}
        </p>
        {isPending ? (
          <Skeleton className="h-40" />
        ) : loadError && !data ? (
          // 查詢失敗：說明並提供重試，不是一片空白
          <QueryError
            error={loadError}
            onRetry={() => void refetch()}
            data-testid="notification-event-error"
          />
        ) : (
          categories.map((view) => (
            <section
              key={view.category}
              className="rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface)] px-4"
              aria-label={view.labelKey ? t(view.labelKey) : view.category}
              data-testid="notification-event-category"
              data-value={view.category}
            >
              <h2 className="m-0 pt-4 text-base font-medium">
                {view.labelKey ? t(view.labelKey) : view.category}
              </h2>
              {view.events.map((event) => (
                <NotificationEventRow
                  key={event.type}
                  event={event}
                  canUpdate={canUpdate}
                  current={draft.current}
                  onChange={draft.setEnabled}
                  onAllowUserOverrideChange={draft.setAllowUserOverride}
                  onReset={draft.resetToDefault}
                />
              ))}
            </section>
          ))
        )}
        {canUpdate && draft.isDirty && (
          <footer className="sticky bottom-0 flex justify-end gap-2 border-t border-[var(--color-border)] bg-[var(--color-bg)] py-3">
            <Button onClick={draft.clear} data-testid="notification-event-discard">
              {t('notification.event.discard')}
            </Button>
            <Button
              variant="primary"
              loading={update.isPending}
              onClick={save}
              data-testid="notification-event-save"
            >
              {t('common.save')}
            </Button>
          </footer>
        )}
      </div>
    </SystemSettingsLayout>
  );
}
