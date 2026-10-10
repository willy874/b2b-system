import { Button } from '@b2b-system/ui/Button';
import { Chip } from '@b2b-system/ui/Chip';
import { Icon } from '@b2b-system/ui/Icon';
import { Skeleton } from '@b2b-system/ui/Skeleton';
import { QueryBoundary } from '@b2b-system/web-core/components';
import { useTranslation } from '@b2b-system/web-core/locales';
import { useToast } from '@b2b-system/web-core/notify';
import { useUnsavedChangesGuard } from '@b2b-system/web-core/router';
import { formatDateTime } from '@b2b-system/web-shared/date';
import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';

import { getApprovalDetailQueryOptions } from '@/apis/approval/get-approval-detail/query';
import type { ApprovalListParams } from '@/apis/approval/types';
import { getAuthProfileQueryOptions } from '@/apis/auth/get-profile/query';
import { getRoleOptionsQueryOptions } from '@/apis/role/get-role-list/query';
import { useIsFeatureReady } from '@/core/feature';
import { ResourcePanels } from '@/core/resource-panel';

import {
  APPROVAL_CHAIN_FEATURE,
  APPROVAL_STATUS_LABEL_KEY,
  APPROVAL_STATUS_TONE,
  APPROVAL_TYPE_LABEL_KEY,
} from '../../../constants';
import { toApprovalDetailVM, withoutChain } from '../adapter';
import { useApprovalReview } from '../useApprovalReview';
import type { ApprovalReviewOutcome } from '../useApprovalReview';
import { useApprovalReviewAccess } from '../useApprovalReviewAccess';
import { useNextApproval } from '../useNextApproval';
import { ApprovalActionPanel } from './ApprovalActionPanel';
import { ApprovalStatusBanner } from './ApprovalStatusBanner';
import { ApprovalSummary } from './ApprovalSummary';
import { ApprovalTimeline } from './ApprovalTimeline';

interface ApprovalDetailViewProps {
  approvalId: string;
  /** 「回到列表」的文字（審批總表與「我的審批」不同）。 */
  backLabel: string;
  /** 回到開啟它的列表（帶著原本的篩選）；決定後離開時帶 `ignoreBlocker`。 */
  onBack: (options?: { ignoreBlocker?: boolean }) => void;
  /** 打開另一筆（下一筆、重新送出的前後筆），留在同一個列表脈絡裡。 */
  onOpen: (approvalId: string, options?: { ignoreBlocker?: boolean }) => void;
  /**
   * 從待審清單點進來時是那份清單的查詢條件：定案後前往下一筆（docs/architecture/backend/20-approval.md §12 D5）。
   * 從通知或網址直接進來時省略，定案後留在原頁。
   */
  queue?: ApprovalListParams;
}

/**
 * 審批詳情（整頁，docs/architecture/backend/20-approval.md §11.3、§12 D1）：審批總表與「我的審批」共用。
 * 上方一句話的狀態；左欄申請內容與留言，右欄審核流程與這個人能做的操作。能做什麼由後端的 `viewer` 決定。
 * 頁面以 `approvalId` 為 key 掛載：換到下一筆時表單與「下一筆」的清單快照從頭開始。
 */
export function ApprovalDetailView({
  approvalId,
  backLabel,
  onBack,
  onOpen,
  queue,
}: ApprovalDetailViewProps) {
  const { t } = useTranslation();
  const toast = useToast();
  const detail = useQuery(getApprovalDetailQueryOptions(approvalId));
  const profile = useQuery(getAuthProfileQueryOptions());
  const isChainReady = useIsFeatureReady(APPROVAL_CHAIN_FEATURE);
  const approval = useMemo(() => {
    if (!detail.data) return undefined;
    const vm = toApprovalDetailVM(detail.data);
    // 平台關掉多階段時，進行中的多關請求以單關定案：橫幅、時間軸、操作都照單關顯示（§9.11）
    return isChainReady ? vm : withoutChain(vm);
  }, [detail.data, isChainReady]);
  const access = useApprovalReviewAccess(approval);
  const findNext = useNextApproval(approvalId, queue);
  const onReviewed = async (outcome: ApprovalReviewOutcome) => {
    if (outcome !== 'decided' || !queue) return;
    const next = await findNext();
    if (next) {
      onOpen(next, { ignoreBlocker: true });
      return;
    }
    toast.info(t('approval.next.done'));
    onBack({ ignoreBlocker: true });
  };
  const review = useApprovalReview(approvalId, (outcome) => void onReviewed(outcome));
  useUnsavedChangesGuard(review.isDirty);
  const roles = useQuery({ ...getRoleOptionsQueryOptions(), enabled: access.canAssignRole });
  const isRequester = Boolean(
    approval?.requesterId && approval.requesterId === profile.data?.user.id,
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4" data-testid="approval-detail-page">
      <header className="flex flex-col gap-1">
        <div>
          <Button
            size="sm"
            variant="ghost"
            startIcon={<Icon name="chevron-left" size={16} />}
            onClick={() => onBack()}
            data-testid="approval-detail-back"
          >
            {backLabel}
          </Button>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="m-0 text-xl font-semibold" data-testid="approval-detail-title">
            {approval ? t(APPROVAL_TYPE_LABEL_KEY[approval.type]) : t('approval.detail.title')}
          </h1>
          {approval && (
            <Chip
              tone={APPROVAL_STATUS_TONE[approval.status]}
              data-testid="approval-detail-status-chip"
              data-value={approval.status}
            >
              {t(APPROVAL_STATUS_LABEL_KEY[approval.status])}
            </Chip>
          )}
        </div>
        {approval && (
          <p className="m-0 text-sm text-[var(--color-fg-muted)]">
            {t('approval.detail.subtitle', {
              name: approval.requesterName,
              time: formatDateTime(approval.createdAt),
            })}
          </p>
        )}
      </header>

      {/* 例：從通知點進一筆已不存在（或看不到）的審批：說明原因並提供返回 */}
      {!approval && (
        <QueryBoundary
          query={detail}
          skeleton={<Skeleton height={240} />}
          backAction={<Button onClick={() => onBack()}>{backLabel}</Button>}
          data-testid="approval-detail-error"
        >
          {() => null}
        </QueryBoundary>
      )}

      {approval && (
        <>
          <ApprovalStatusBanner
            approval={approval}
            isRequester={isRequester}
            onOpenApproval={(id) => onOpen(id)}
          />
          <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_26rem]">
            <div className="flex min-w-0 flex-col gap-4">
              <section className="flex flex-col gap-3 rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
                <h2 className="m-0 text-base font-medium">{t('approval.detail.content')}</h2>
                <ApprovalSummary approval={approval} />
              </section>
              <ResourcePanels resourceType="approval" resourceId={approval.id} />
            </div>
            <aside className="flex min-w-0 flex-col gap-4">
              <ApprovalActionPanel
                approval={approval}
                review={review}
                roleOptions={roles.data?.items}
              />
              <div className="rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
                <ApprovalTimeline approval={approval} />
              </div>
            </aside>
          </div>
        </>
      )}
    </div>
  );
}
