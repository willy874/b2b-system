import { Button } from '@b2b-system/ui/Button';
import { Icon } from '@b2b-system/ui/Icon';
import { useTranslation } from '@b2b-system/web-core/locales';
import { useQuery } from '@tanstack/react-query';

import { getFileAccessRequestListQueryOptions } from '@/apis/file/get-file-access-requests/query';
import type { FileAccessRequest } from '@/shared/api-sdk';

import { FILE_GRANT_LEVEL_LABEL_KEY } from '../../../constants';
import { useFileAccessReviewMutation } from '../../../hooks/useFolderGrantMutations';

/** 待審的存取申請（docs/rbac/07-resource-grants.md §6.5）；沒有申請時不顯示。 */
export function FileAccessRequestSection({ folderId }: { folderId: string }) {
  const { t } = useTranslation();
  const requests = useQuery(getFileAccessRequestListQueryOptions(folderId));
  const items = requests.data?.items ?? [];
  if (items.length === 0) return null;
  return (
    <section className="flex flex-col gap-2" aria-label={t('file.access.requests')}>
      <h3 className="text-sm font-medium text-[var(--color-fg-muted)]">
        {t('file.access.requests')}
      </h3>
      <ul className="flex flex-col divide-y divide-[var(--color-border)] rounded-md border border-[var(--color-border)] px-3">
        {items.map((request) => (
          <AccessRequestRow key={request.id} folderId={folderId} request={request} />
        ))}
      </ul>
    </section>
  );
}

function AccessRequestRow({ folderId, request }: { folderId: string; request: FileAccessRequest }) {
  const { t } = useTranslation();
  const review = useFileAccessReviewMutation();
  const decide = (decision: 'approve' | 'reject') =>
    review.mutate({ params: { folderId, requestId: request.id, decision, body: {} } });
  return (
    <li
      className="flex flex-wrap items-center gap-2 py-2"
      data-testid="file-access-request"
      data-value={request.id}
    >
      <Icon name="user" size={16} className="text-[var(--color-fg-muted)]" />
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-sm">{request.requesterName}</span>
        <span className="text-xs text-[var(--color-fg-muted)]">
          {[
            t('file.access.requestedLevel', {
              level: t(FILE_GRANT_LEVEL_LABEL_KEY[request.level]),
            }),
            request.reason,
          ]
            .filter(Boolean)
            .join(' · ')}
        </span>
      </div>
      <Button
        size="sm"
        variant="primary"
        disabled={review.isPending}
        onClick={() => decide('approve')}
        data-testid="file-access-request-approve"
      >
        {t('file.access.approve')}
      </Button>
      <Button
        size="sm"
        variant="ghost"
        disabled={review.isPending}
        onClick={() => decide('reject')}
        data-testid="file-access-request-reject"
      >
        {t('file.access.reject')}
      </Button>
    </li>
  );
}
