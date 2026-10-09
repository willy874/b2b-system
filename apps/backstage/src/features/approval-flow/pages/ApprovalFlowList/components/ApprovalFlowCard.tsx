import { ButtonLink } from '@b2b-system/ui/Button';
import { Chip } from '@b2b-system/ui/Chip';
import { Icon } from '@b2b-system/ui/Icon';
import { useTranslation } from '@b2b-system/web-core/locales';
import { cn } from '@b2b-system/web-shared/utils';
import { Link } from '@tanstack/react-router';

import {
  APPROVAL_FLOW_STATUS_LABEL_KEY,
  APPROVAL_FLOW_STATUS_TONE,
  APPROVAL_FLOW_TYPE_LABEL_KEY,
} from '../../../constants';
import { ApprovalFlowEditRoute } from '../../../routes';
import type { ApprovalFlowCardVM } from '../adapter';
import { FlowStatsLine } from './FlowStatsLine';

interface ApprovalFlowCardProps {
  card: ApprovalFlowCardVM;
  canUpdate: boolean;
}

/** 動作鈕的文字：唯讀時一律「檢視」；能改時沒有流程是「設定」，有流程是「編輯」。 */
const ACTION_LABEL_KEY = {
  view: 'approvalFlow.list.action.view',
  unset: 'approvalFlow.list.action.configure',
  enabled: 'approvalFlow.list.action.edit',
  disabled: 'approvalFlow.list.action.edit',
} as const;

/** 目前的審批方式（沒有流程、流程停用時都是單關審批，照常運作）。 */
const MODE_LABEL_KEY = {
  unset: 'approvalFlow.list.mode.unset',
  enabled: 'approvalFlow.list.mode.enabled',
  disabled: 'approvalFlow.list.mode.disabled',
} as const;

/**
 * 一種審批類型「目前怎麼審」：沒有流程時明講是單關審批（預設，照常運作），
 * 不是空白的欄位——列表上的「-」會讓人以為沒有資料。
 */
export function ApprovalFlowCard({ card, canUpdate }: ApprovalFlowCardProps) {
  const { t } = useTranslation();
  const labelKey = APPROVAL_FLOW_TYPE_LABEL_KEY[card.type];
  const label = labelKey ? t(labelKey) : card.type;
  const link = { to: ApprovalFlowEditRoute.to, params: { type: card.type } } as const;

  return (
    <article
      className="flex flex-col gap-3 rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface)] p-4"
      aria-label={label}
      data-testid="approval-flow-card"
      data-value={card.type}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <h2 className="m-0 text-base font-medium">
            <Link {...link} data-testid="approval-flow-type-link" data-value={card.type}>
              {label}
            </Link>
          </h2>
          <div className="flex flex-wrap items-center gap-2 text-sm text-[var(--color-fg-muted)]">
            <Chip
              tone={APPROVAL_FLOW_STATUS_TONE[card.status]}
              data-testid="approval-flow-status"
              data-value={card.status}
            >
              {t(APPROVAL_FLOW_STATUS_LABEL_KEY[card.status])}
            </Chip>
            {card.hasAssigneeIssue && (
              <Chip tone="danger" data-testid="approval-flow-assignee-issue">
                {t('approvalFlow.list.assigneeIssue')}
              </Chip>
            )}
            {card.version !== null && (
              <span data-testid="approval-flow-version">
                {t('approvalFlow.edit.version', { version: card.version })}
              </span>
            )}
          </div>
        </div>
        <ButtonLink
          {...link}
          size="sm"
          variant={canUpdate && card.status === 'unset' ? 'primary' : 'secondary'}
          endIcon={<Icon name="chevron-right" size={16} />}
          data-testid="approval-flow-open"
        >
          {t(ACTION_LABEL_KEY[canUpdate ? card.status : 'view'])}
        </ButtonLink>
      </div>

      <p className="m-0 text-sm text-[var(--color-fg-muted)]" data-testid="approval-flow-mode">
        {t(
          card.status === 'unset' && canUpdate
            ? 'approvalFlow.list.mode.unsetCanUpdate'
            : MODE_LABEL_KEY[card.status],
        )}
      </p>

      {card.stepNames.length > 0 && (
        <ol
          className={cn(
            'm-0 flex list-none flex-wrap items-center gap-2 p-0 text-sm',
            card.status === 'disabled' && 'opacity-60',
          )}
          aria-label={t('approvalFlow.list.stepsLabel')}
          data-testid="approval-flow-steps"
        >
          {card.stepNames.map((name, index) => (
            // oxlint-disable-next-line react/no-array-index-key -- 關卡名稱可以重複；唯讀的摘要，不會重排
            <li key={index} className="flex items-center gap-2">
              {index > 0 && (
                <Icon name="chevron-right" size={14} className="text-[var(--color-fg-muted)]" />
              )}
              <span className="flex items-center gap-1.5 rounded-full border border-[var(--color-border)] py-0.5 pr-2.5 pl-1">
                <span
                  className="flex h-5 w-5 items-center justify-center rounded-full bg-[var(--color-fill-subtle)] text-xs"
                  aria-hidden
                >
                  {index + 1}
                </span>
                <span data-testid="approval-flow-step-summary">{name}</span>
              </span>
            </li>
          ))}
        </ol>
      )}

      <FlowStatsLine type={card.type} />
    </article>
  );
}
