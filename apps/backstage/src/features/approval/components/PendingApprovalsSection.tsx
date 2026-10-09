import { useTranslation } from '@b2b-system/web-core/locales';
import { formatRelativeTime } from '@b2b-system/web-shared/date';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';

import { getApprovalListQueryOptions } from '@/apis/approval/get-approval-list/query';

import { APPROVAL_TYPE_LABEL_KEY } from '../constants';
import { useApprovalCounts } from '../hooks/useApprovalCounts';
import { useApprovalPermission } from '../hooks/useApprovalPermission';
import { toMyApprovalListParams } from '../pages/MyApprovalList/adapter';
import { ApprovalListRoute, MyApprovalDetailRoute, MyApprovalRoute } from '../routes';

/** 首頁列出的待我審核筆數：最早送出的幾筆（與「待我審核」同一個順序），其餘從「全部」進入。 */
const PREVIEW_LIMIT = 3;

/**
 * 首頁的「待辦」區塊（docs/architecture/backend/20-approval.md §11.1）：待我審核（多階段的關卡）最舊的幾筆，
 * 以及審核者看得到的全部待審數。兩者都是 0 時不渲染。
 */
export function PendingApprovalsSection() {
  const { t } = useTranslation();
  const counts = useApprovalCounts();
  const { canReview } = useApprovalPermission();
  const assigned = counts?.assigned ?? 0;
  const pending = canReview ? (counts?.pending ?? 0) : 0;
  const oldest = useQuery({
    ...getApprovalListQueryOptions({
      params: toMyApprovalListParams({ offset: 0, limit: PREVIEW_LIMIT }, 'assigned'),
    }),
    enabled: assigned > 0,
  });

  if (assigned === 0 && pending === 0) return null;

  return (
    <section
      className="flex flex-col gap-3 rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface)] p-4"
      data-testid="home-pending-approvals"
    >
      <h2 className="m-0 text-base font-medium">{t('approval.home.title')}</h2>
      {assigned > 0 && (
        <div className="flex flex-col gap-2">
          <div className="flex items-baseline justify-between gap-2 text-sm">
            <span data-testid="home-pending-approvals-assigned" data-value={assigned}>
              {t('approval.home.assigned', { count: assigned })}
            </span>
            <Link
              to={MyApprovalRoute.to}
              search={{ tab: 'assigned' }}
              className="text-[var(--color-brand)]"
              data-testid="home-pending-approvals-all"
            >
              {t('approval.home.viewAll')}
            </Link>
          </div>
          <ul className="m-0 flex list-none flex-col gap-1 p-0 text-sm">
            {(oldest.data?.items ?? []).map((item) => (
              <li key={item.id} className="flex flex-wrap items-baseline gap-x-2">
                <Link
                  to={MyApprovalDetailRoute.to}
                  params={{ approvalId: item.id }}
                  search={{ tab: 'assigned', queue: true }}
                  className="font-medium text-[var(--color-brand)]"
                  data-testid="home-pending-approval"
                  data-value={item.id}
                >
                  {t(APPROVAL_TYPE_LABEL_KEY[item.type])}
                </Link>
                <span>{item.requesterName}</span>
                {item.currentStep && (
                  <span className="text-xs text-[var(--color-fg-muted)]">
                    {t('approval.home.waiting', {
                      step: item.currentStep.name,
                      since: formatRelativeTime(item.currentStep.activatedAt ?? item.createdAt),
                    })}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
      {pending > 0 && (
        <div className="flex items-baseline justify-between gap-2 text-sm">
          <span data-testid="home-pending-approvals-pending" data-value={pending}>
            {t('approval.home.pending', { count: pending })}
          </span>
          <Link
            to={ApprovalListRoute.to}
            className="text-[var(--color-brand)]"
            data-testid="home-pending-approvals-review"
          >
            {t('approval.home.review')}
          </Link>
        </div>
      )}
    </section>
  );
}
