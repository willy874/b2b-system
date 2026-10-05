import { Button } from '@b2b-system/ui/Button';
import { Chip } from '@b2b-system/ui/Chip';
import { useConfirm } from '@b2b-system/ui/ConfirmDialog';
import { isVersionConflict, useErrorMessage, useErrorToast } from '@b2b-system/web-core/errors';
import { useTranslation } from '@b2b-system/web-core/locales';
import { useUnsavedChangesGuard } from '@b2b-system/web-core/router';
import { formatDateTime } from '@b2b-system/web-shared/date';
import { useQueryClient } from '@tanstack/react-query';
import { useId, useState } from 'react';

import { getAnnouncementDetailQueryOptions } from '@/apis/announcement/get-announcement-detail/query';
import { VersionConflictAlert } from '@/core/components';
import type { Announcement } from '@/shared/api-sdk';

import { AnnouncementForm } from '../../../components/AnnouncementForm';
import type { AnnouncementDraft } from '../../../components/AnnouncementForm';
import { toDraft, toRequest } from '../../../components/draft';
import { describeTrigger } from '../../../components/triggerSummary';
import {
  ANNOUNCEMENT_STATUS_LABEL_KEY,
  ANNOUNCEMENT_STATUS_TONE,
  PUBLISH_CONFIRM_KEY,
} from '../../../constants';
import {
  useAnnouncementDeleteMutation,
  useAnnouncementPauseMutation,
  useAnnouncementPublishMutation,
  useAnnouncementResumeMutation,
  useAnnouncementUpdateMutation,
} from '../../../hooks/useAnnouncementMutations';
import { audienceSummary } from '../adapter';

interface AnnouncementSettingsSectionProps {
  announcement: Announcement;
  canUpdate: boolean;
  canDelete: boolean;
  canPublish: boolean;
  /** 刪除後關閉對話框。 */
  onDeleted: () => void;
}

/**
 * 公告的內容與狀態操作（docs/architecture/backend/19-announcement.md §9）：草稿可以編輯與送出；排程中可以暫停、改時間；
 * 暫停中可以恢復。草稿以外的公告會對外發話，編輯要 `announcement:publish`；已完成的不能改。
 */
export function AnnouncementSettingsSection({
  announcement,
  canUpdate,
  canDelete,
  canPublish,
  onDeleted,
}: AnnouncementSettingsSectionProps) {
  const { t, language } = useTranslation();
  const queryClient = useQueryClient();
  const confirm = useConfirm();
  const showError = useErrorToast();
  const toMessage = useErrorMessage();
  const formId = useId();
  const update = useAnnouncementUpdateMutation();
  const publish = useAnnouncementPublishMutation();
  const pause = useAnnouncementPauseMutation();
  const resume = useAnnouncementResumeMutation();
  const remove = useAnnouncementDeleteMutation();
  const [draft, setDraft] = useState<AnnouncementDraft>();
  const [version, setVersion] = useState(announcement.version);
  const [reloading, setReloading] = useState(false);
  useUnsavedChangesGuard(draft !== undefined);

  const { status } = announcement;
  const canEdit = status !== 'completed' && canUpdate && (status === 'draft' || canPublish);
  const request = draft && toRequest(draft);
  const params = { announcementId: announcement.id, body: { version: announcement.version } };

  const startEditing = (source: Announcement) => {
    update.reset();
    setDraft(toDraft(source));
    setVersion(source.version);
  };

  /** 衝突後放棄這次的修改：重抓最新的內容與版本，表單改成以它為基礎。 */
  const reload = async () => {
    setReloading(true);
    try {
      startEditing(
        await queryClient.fetchQuery({
          ...getAnnouncementDetailQueryOptions(announcement.id),
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
    if (!request) return;
    try {
      await update.mutateAsync({
        params: { announcementId: announcement.id, body: { ...request, version } },
      });
    } catch {
      // 錯誤顯示在表單上；輸入保留，讓使用者修正後重送
      return;
    }
    setDraft(undefined);
  };

  const confirmPublish = () =>
    void confirm({
      title: t('announcement.publish.title'),
      description: t(PUBLISH_CONFIRM_KEY[announcement.trigger.kind], {
        title: announcement.title,
        at: describeTrigger(t, language, announcement.trigger),
      }),
      confirmLabel: t('announcement.publish.action'),
      onConfirm: async () => {
        await publish.mutateAsync({ params });
      },
      'data-testid': 'announcement-publish-confirm',
    });

  const confirmDelete = () =>
    void confirm({
      title: t('announcement.delete.title'),
      description: t('announcement.delete.confirm', { title: announcement.title }),
      confirmLabel: t('common.delete'),
      tone: 'danger',
      onConfirm: async () => {
        await remove.mutateAsync({ params: { announcementId: announcement.id } });
        onDeleted();
      },
      'data-testid': 'announcement-delete-confirm',
    });

  const formError =
    update.error && !isVersionConflict(update.error) ? toMessage(update.error) : undefined;

  if (draft) {
    return (
      <section className="flex flex-col gap-3" data-testid="announcement-settings-section">
        {status !== 'draft' && (
          <p className="m-0 text-sm text-[var(--color-warning-text)]">
            {t('announcement.update.publishedNotice')}
          </p>
        )}
        <AnnouncementForm
          id={formId}
          value={draft}
          onChange={setDraft}
          onSubmit={() => void save()}
          allowImmediate={status === 'draft'}
        />
        {isVersionConflict(update.error) && (
          <VersionConflictAlert
            error={update.error}
            onReload={() => void reload()}
            reloading={reloading}
          />
        )}
        {formError && (
          <p role="alert" className="m-0 text-sm text-[var(--color-danger-text)]">
            {formError}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <Button onClick={() => setDraft(undefined)}>{t('common.cancel')}</Button>
          <Button
            variant="primary"
            type="submit"
            form={formId}
            disabled={!request}
            loading={update.isPending}
            data-testid="announcement-save"
          >
            {t('common.save')}
          </Button>
        </div>
      </section>
    );
  }

  return (
    <section className="flex flex-col gap-3" data-testid="announcement-settings-section">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Chip
          tone={ANNOUNCEMENT_STATUS_TONE[status]}
          data-testid="announcement-detail-status"
          data-value={status}
        >
          {t(ANNOUNCEMENT_STATUS_LABEL_KEY[status])}
        </Chip>
        <div className="flex flex-wrap gap-2">
          {canEdit && (
            <Button
              size="sm"
              onClick={() => startEditing(announcement)}
              data-testid="announcement-edit"
            >
              {t('common.edit')}
            </Button>
          )}
          {canPublish && status === 'draft' && (
            <Button
              size="sm"
              variant="primary"
              onClick={confirmPublish}
              loading={publish.isPending}
              data-testid="announcement-publish"
            >
              {t('announcement.publish.action')}
            </Button>
          )}
          {canPublish && status === 'scheduled' && (
            <Button
              size="sm"
              onClick={() => void pause.mutateAsync({ params }).catch(() => undefined)}
              loading={pause.isPending}
              data-testid="announcement-pause"
            >
              {t('announcement.pause.action')}
            </Button>
          )}
          {canPublish && status === 'paused' && (
            <Button
              size="sm"
              onClick={() => void resume.mutateAsync({ params }).catch(() => undefined)}
              loading={resume.isPending}
              data-testid="announcement-resume"
            >
              {t('announcement.resume.action')}
            </Button>
          )}
          {canDelete && (
            <Button
              size="sm"
              variant="danger"
              onClick={confirmDelete}
              data-testid="announcement-delete"
            >
              {t('common.delete')}
            </Button>
          )}
        </div>
      </div>

      <dl className="m-0 grid grid-cols-[8rem_1fr] gap-x-3 gap-y-2 text-sm">
        <dt className="text-[var(--color-fg-muted)]">{t('announcement.field.trigger')}</dt>
        <dd className="m-0" data-testid="announcement-detail-trigger">
          {describeTrigger(t, language, announcement.trigger)}
          {announcement.nextRunAt && (
            <span
              className="ml-2 text-[var(--color-fg-muted)]"
              data-testid="announcement-detail-next-run"
            >
              {t('announcement.detail.nextRun', { at: formatDateTime(announcement.nextRunAt) })}
            </span>
          )}
        </dd>
        <dt className="text-[var(--color-fg-muted)]">{t('announcement.field.audience')}</dt>
        <dd className="m-0" data-testid="announcement-detail-audience">
          {audienceSummary(announcement.audience)
            .map((part) => t(part.key, part.args))
            .join('、')}
        </dd>
        <dt className="text-[var(--color-fg-muted)]">{t('announcement.field.title')}</dt>
        <dd className="m-0 font-medium">{announcement.title}</dd>
        <dt className="text-[var(--color-fg-muted)]">{t('announcement.field.body')}</dt>
        <dd className="m-0 whitespace-pre-wrap" data-testid="announcement-detail-body">
          {announcement.body}
        </dd>
      </dl>
    </section>
  );
}
