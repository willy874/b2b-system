import { Chip } from '@b2b-system/ui/Chip';
import { Icon } from '@b2b-system/ui/Icon';
import type { IconName } from '@b2b-system/ui/Icon';
import { useTranslation } from '@b2b-system/web-core/locales';
import { formatDateTime, formatRelativeTime } from '@b2b-system/web-shared/date';
import { cn } from '@b2b-system/web-shared/utils';
import type { ReactNode } from 'react';

import {
  APPROVAL_ASSIGNEE_KIND_LABEL_KEY,
  APPROVAL_CLOSE_REASON_LABEL_KEY,
  APPROVAL_DECISION_VIA_LABEL_KEY,
  APPROVAL_SHORTAGE_LABEL_KEY,
  APPROVAL_STEP_STATUS_LABEL_KEY,
  APPROVAL_STEP_STATUS_TONE,
} from '../../../constants';
import type { ApprovalDetailVM, ApprovalStepVM } from '../adapter';
import { useApprovalOutcome } from '../useApprovalOutcome';

interface ApprovalTimelineProps {
  approval: ApprovalDetailVM;
}

/** 節點的狀態：決定圖示與顏色。 */
type NodeState = 'done' | 'current' | 'rejected' | 'upcoming' | 'skipped';

const NODE_ICON = {
  done: 'check',
  current: 'more',
  rejected: 'close',
  upcoming: 'minus',
  skipped: 'minus',
} as const satisfies Record<NodeState, IconName>;

const NODE_MARKER_CLASS = {
  done: 'border-[var(--color-success)] bg-[var(--color-success)] text-[var(--color-success-on)]',
  current: 'border-[var(--color-brand)] bg-[var(--color-surface)] text-[var(--color-brand)]',
  rejected: 'border-[var(--color-danger)] bg-[var(--color-danger)] text-[var(--color-danger-on)]',
  upcoming: 'border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-fg-muted)]',
  skipped:
    'border-[var(--color-border)] bg-[var(--color-fill-subtle)] text-[var(--color-fg-muted)]',
} as const satisfies Record<NodeState, string>;

const STEP_NODE_STATE = {
  waiting: 'upcoming',
  active: 'current',
  approved: 'done',
  rejected: 'rejected',
  skipped: 'skipped',
  cancelled: 'skipped',
} as const satisfies Record<ApprovalStepVM['status'], NodeState>;

const REQUEST_NODE_STATE = {
  pending: 'current',
  approved: 'done',
  rejected: 'rejected',
  withdrawn: 'skipped',
} as const satisfies Record<ApprovalDetailVM['status'], NodeState>;

/** 一個人在這一關的狀態。 */
const PERSON_STATE_ICON = {
  approve: 'check',
  reject: 'close',
  pending: 'more',
} as const satisfies Record<'approve' | 'reject' | 'pending', IconName>;

const PERSON_STATE_CLASS = {
  approve: 'text-[var(--color-success-text)]',
  reject: 'text-[var(--color-danger-text)]',
  pending: 'text-[var(--color-fg-muted)]',
} as const satisfies Record<'approve' | 'reject' | 'pending', string>;

const PERSON_STATE_LABEL_KEY = {
  approve: 'approval.step.decision.approve',
  reject: 'approval.step.decision.reject',
  pending: 'approval.flow.notYet',
} as const satisfies Record<'approve' | 'reject' | 'pending', string>;

/**
 * 審核流程（docs/architecture/backend/20-approval.md §11.3）：縱向的節點，從「送出申請」到「核准後的結果」。
 * 多階段的每一關列出規則、同意數與 **每一個審核者** 的狀態（已同意、已駁回、尚未動作）；單關請求以一個「審核」節點表示。
 * 停用多階段期間照樣唯讀顯示（那是誰同意過的紀錄，§9.11）。
 */
export function ApprovalTimeline({ approval }: ApprovalTimelineProps) {
  const { t } = useTranslation();
  const outcome = useApprovalOutcome(approval);
  const finalState: NodeState =
    approval.status === 'pending' ? 'upcoming' : REQUEST_NODE_STATE[approval.status];

  return (
    <section className="flex flex-col gap-3" data-testid="approval-timeline">
      <h2 className="m-0 text-base font-medium">{t('approval.flow.title')}</h2>
      <ol className="m-0 flex list-none flex-col p-0">
        <Node state="done" title={t('approval.flow.submitted')} testId="approval-flow-submitted">
          <Muted>
            {approval.requesterName} · {formatDateTime(approval.createdAt)}
          </Muted>
        </Node>

        {approval.steps.length === 0 ? (
          <Node
            state={REQUEST_NODE_STATE[approval.status]}
            title={t('approval.flow.single')}
            testId="approval-flow-single"
          >
            <Muted>{t('approval.flow.singleHint')}</Muted>
            {approval.reviewerName && (
              <Muted>
                {approval.reviewerName} · {formatDateTime(approval.reviewedAt)}
              </Muted>
            )}
          </Node>
        ) : (
          approval.steps.map((step, index) => (
            <StepNode key={step.ordinal} step={step} position={index + 1} />
          ))
        )}

        <Node
          state={finalState}
          title={t(
            approval.status === 'pending'
              ? 'approval.flow.outcomePending'
              : 'approval.flow.outcomeDone',
          )}
          last
          testId="approval-flow-outcome"
        >
          <Muted>{approval.status === 'approved' || approval.isPending ? outcome : '-'}</Muted>
        </Node>
      </ol>
    </section>
  );
}

function StepNode({ step, position }: { step: ApprovalStepVM; position: number }) {
  const { t } = useTranslation();
  const rule = step.assignee.label
    ? t('approval.step.assigneeWithLabel', {
        kind: t(APPROVAL_ASSIGNEE_KIND_LABEL_KEY[step.assignee.kind]),
        label: step.assignee.label,
      })
    : t(APPROVAL_ASSIGNEE_KIND_LABEL_KEY[step.assignee.kind], {
        level: step.assignee.kind === 'manager' ? step.assignee.level : undefined,
      });
  const decidedBy = new Map(step.decisions.map((decision) => [decision.reviewerId, decision]));
  // 強制定案、停用期間的單關定案：做決定的人不一定是候選人
  const outsiders = step.decisions.filter(
    (decision) => !step.candidates.some((candidate) => candidate.userId === decision.reviewerId),
  );

  return (
    <Node
      state={STEP_NODE_STATE[step.status]}
      title={t('approval.flow.stepTitle', { position, name: step.name })}
      testId="approval-step"
      value={String(step.ordinal)}
      status={step.status}
      badge={
        <>
          <Chip tone={APPROVAL_STEP_STATUS_TONE[step.status]} data-testid="approval-step-status">
            {t(APPROVAL_STEP_STATUS_LABEL_KEY[step.status])}
          </Chip>
          {step.shortage && step.status === 'active' && (
            <Chip tone="danger" data-testid="approval-step-shortage" data-value={step.shortage}>
              {t(APPROVAL_SHORTAGE_LABEL_KEY[step.shortage])}
            </Chip>
          )}
        </>
      }
    >
      <Muted>
        {rule}
        {step.required !== null &&
          step.status !== 'skipped' &&
          ` · ${t('approval.step.count', { approvals: step.approvals, required: step.required })}`}
        {step.closeReason && ` · ${t(APPROVAL_CLOSE_REASON_LABEL_KEY[step.closeReason])}`}
      </Muted>
      {step.status === 'skipped' && <Muted>{t('approval.step.skippedHint')}</Muted>}
      {step.status === 'active' && step.activatedAt && (
        <Muted testId="approval-step-since">
          {t('approval.flow.since', { since: formatRelativeTime(step.activatedAt) })}
        </Muted>
      )}
      {(step.candidates.length > 0 || outsiders.length > 0) && (
        <ul className="m-0 mt-1 flex list-none flex-col gap-1 p-0 text-sm">
          {step.candidates.map((candidate) => {
            const decision = decidedBy.get(candidate.userId);
            // 已結束的關卡裡沒做決定的人不算「尚未動作」：輪不到他了
            if (!decision && step.status !== 'active') return null;
            return (
              <Person
                key={candidate.userId}
                name={candidate.name}
                state={decision?.decision ?? 'pending'}
                decision={decision}
              />
            );
          })}
          {outsiders.map((decision) => (
            <Person
              key={`${decision.reviewerName}-${decision.decidedAt.toISOString()}`}
              name={decision.reviewerName}
              state={decision.decision}
              decision={decision}
            />
          ))}
        </ul>
      )}
    </Node>
  );
}

function Person({
  name,
  state,
  decision,
}: {
  name: string;
  state: 'approve' | 'reject' | 'pending';
  decision: ApprovalStepVM['decisions'][number] | undefined;
}) {
  const { t } = useTranslation();
  return (
    <li data-testid="approval-step-person" data-value={name} data-state={state}>
      <span className="inline-flex flex-wrap items-center gap-x-2">
        <Icon name={PERSON_STATE_ICON[state]} size={14} className={PERSON_STATE_CLASS[state]} />
        <span className="font-medium">{name}</span>
        <span className={PERSON_STATE_CLASS[state]}>
          {t(PERSON_STATE_LABEL_KEY[state])}
          {decision &&
            decision.via !== 'assignee' &&
            t('approval.step.viaSuffix', { via: t(APPROVAL_DECISION_VIA_LABEL_KEY[decision.via]) })}
        </span>
        {decision && (
          <span className="text-xs text-[var(--color-fg-muted)]">
            {formatDateTime(decision.decidedAt)}
          </span>
        )}
      </span>
      {decision?.comment && (
        <p className="m-0 ps-5 text-xs text-[var(--color-fg-muted)]">{decision.comment}</p>
      )}
    </li>
  );
}

function Node({
  state,
  title,
  badge,
  last,
  testId,
  value,
  status,
  children,
}: {
  state: NodeState;
  title: string;
  badge?: ReactNode;
  last?: boolean;
  testId: string;
  value?: string;
  status?: string;
  children?: ReactNode;
}) {
  return (
    <li
      className="grid grid-cols-[1.5rem_1fr] gap-x-3"
      data-testid={testId}
      data-value={value}
      data-status={status}
      data-state={state}
    >
      <span className="flex flex-col items-center">
        <span
          className={cn(
            'flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2',
            NODE_MARKER_CLASS[state],
          )}
        >
          <Icon name={NODE_ICON[state]} size={14} />
        </span>
        {!last && <span className="w-px flex-1 bg-[var(--color-border)]" />}
      </span>
      <div className={cn('flex flex-col gap-1', !last && 'pb-4')}>
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium">{title}</span>
          {badge}
        </div>
        {children}
      </div>
    </li>
  );
}

function Muted({ children, testId }: { children: ReactNode; testId?: string }) {
  return (
    <p className="m-0 text-xs text-[var(--color-fg-muted)]" data-testid={testId}>
      {children}
    </p>
  );
}
