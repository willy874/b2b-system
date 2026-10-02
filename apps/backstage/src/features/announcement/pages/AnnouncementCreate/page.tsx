import { useNavigate } from '@tanstack/react-router';
import { useId, useState } from 'react';

import { Button } from '@/components/Button';
import { Dialog } from '@/components/Dialog';
import { useErrorMessage } from '@/core/errors';
import { useTranslation } from '@/core/locales';
import { useUnsavedChangesGuard } from '@/core/router';

import { AnnouncementForm } from '../../components/AnnouncementForm';
import type { AnnouncementDraft } from '../../components/AnnouncementForm';
import { EMPTY_DRAFT, toRequest } from '../../components/draft';
import { useAnnouncementCreateMutation } from '../../hooks/useAnnouncementMutations';
import {
  AnnouncementCreateRoute,
  AnnouncementDetailRoute,
  AnnouncementListRoute,
} from '../../routes';

/**
 * 建立公告：先存成草稿，在詳情頁送出（送出要 `announcement:publish`，能寫草稿的人不一定有，D15）。
 */
export default function AnnouncementCreatePage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const search = AnnouncementCreateRoute.useSearch();
  const create = useAnnouncementCreateMutation();
  const toMessage = useErrorMessage();
  const formId = useId();
  const [draft, setDraft] = useState<AnnouncementDraft>(EMPTY_DRAFT);
  const [formError, setFormError] = useState<string>();
  useUnsavedChangesGuard(Boolean(draft.title || draft.body));

  const request = toRequest(draft);
  const close = () => void navigate({ to: AnnouncementListRoute.to, search, ignoreBlocker: true });

  const submit = async () => {
    if (!request) return;
    setFormError(undefined);
    try {
      const created = await create.mutateAsync({ params: { body: request } });
      void navigate({
        to: AnnouncementDetailRoute.to,
        params: { announcementId: created.id },
        search,
        ignoreBlocker: true,
      });
    } catch (error) {
      setFormError(toMessage(error));
    }
  };

  return (
    <Dialog
      open
      onOpenChange={(open) => !open && close()}
      title={t('announcement.create.title')}
      description={t('announcement.create.description')}
      size="lg"
      data-testid="announcement-create-dialog"
      footer={
        <>
          <Button onClick={close}>{t('common.cancel')}</Button>
          <Button
            variant="primary"
            type="submit"
            form={formId}
            disabled={!request}
            loading={create.isPending}
            data-testid="announcement-create-submit"
          >
            {t('announcement.create.submit')}
          </Button>
        </>
      }
    >
      <AnnouncementForm
        id={formId}
        value={draft}
        onChange={setDraft}
        onSubmit={() => void submit()}
        allowImmediate
      />
      {formError && (
        <p className="mt-3 text-sm text-[var(--color-danger-text)]" role="alert">
          {formError}
        </p>
      )}
    </Dialog>
  );
}
