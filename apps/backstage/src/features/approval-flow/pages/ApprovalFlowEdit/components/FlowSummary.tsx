import { Icon } from '@b2b-system/ui/Icon';
import { useTranslation } from '@b2b-system/web-core/locales';
import { cn } from '@b2b-system/web-shared/utils';
import type { ReactNode } from 'react';

import type { ApprovalFlowPreview } from '@/shared/api-sdk';

import { PREVIEW_SHORTAGE_LABEL_KEY } from '../../../constants';
import type { FlowDraft } from '../../../hooks/flowDraft';
import { stepSummaryParts } from '../stepSummary';

interface FlowSummaryProps {
  draft: FlowDraft;
  /** 對應目前草稿的試算結果；有的話標出略過與短缺的關卡。 */
  preview: ApprovalFlowPreview | undefined;
  /** 核准之後會發生什麼（最後一個節點）。 */
  outcome: string;
  /** 點關卡：捲到那張卡片並展開。 */
  onSelect: (stepId: string) => void;
}

/** 節點在試算下的狀態。 */
type PreviewState = 'skipped' | 'shortage' | 'ok' | 'unknown';

const NODE_CLASS = {
  skipped: 'border-dashed border-[var(--color-border)] opacity-60',
  shortage: 'border-[var(--color-danger)]',
  ok: 'border-[var(--color-border)]',
  unknown: 'border-[var(--color-border)]',
} as const satisfies Record<PreviewState, string>;

/**
 * 整條流程的一列摘要（docs/architecture/backend/20-approval.md §9.16）：申請 → 每一關 → 核准後。
 * 每一關附上審核者、同意數與條件數；試算完成時疊上結果（略過變淡、找不到審核者標紅、幾位審核者）。
 */
export function FlowSummary({ draft, preview, outcome, onSelect }: FlowSummaryProps) {
  const { t } = useTranslation();
  return (
    <section
      className="rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] p-4"
      aria-label={t('approvalFlow.summary.title')}
      data-testid="approval-flow-summary"
    >
      <ol className="m-0 flex list-none flex-wrap items-stretch gap-2 p-0 text-sm">
        <Endpoint icon="file-text">{t('approvalFlow.summary.submit')}</Endpoint>
        {draft.steps.map((step, index) => {
          const parts = stepSummaryParts(step, t);
          const result = preview?.steps[index];
          const state: PreviewState = !result
            ? 'unknown'
            : result.skipped
              ? 'skipped'
              : result.shortage
                ? 'shortage'
                : 'ok';
          return (
            <li key={step.id} className="flex items-stretch gap-2">
              <Arrow />
              <button
                type="button"
                className={cn(
                  'flex max-w-56 flex-col items-start gap-0.5 rounded-md border bg-[var(--color-surface)] px-3 py-2 text-start hover:bg-[var(--color-fill-subtle)]',
                  NODE_CLASS[state],
                )}
                onClick={() => onSelect(step.id)}
                data-testid="approval-flow-summary-step"
                data-value={index}
                data-state={state}
              >
                <span className="font-medium">
                  {t('approvalFlow.summary.stepTitle', {
                    ordinal: index + 1,
                    name: step.name.trim() || t('approvalFlow.summary.untitled'),
                  })}
                </span>
                <span className="text-xs text-[var(--color-fg-muted)]">
                  {[parts.assignee, parts.required, parts.conditions].filter(Boolean).join(' · ')}
                </span>
                {result && (
                  <span
                    className={cn(
                      'text-xs',
                      state === 'shortage' && 'text-[var(--color-danger-text)]',
                      state === 'ok' && 'text-[var(--color-success-text)]',
                    )}
                    data-testid="approval-flow-summary-result"
                  >
                    {result.skipped
                      ? t('approvalFlow.preview.skipped')
                      : result.shortage
                        ? t(PREVIEW_SHORTAGE_LABEL_KEY[result.shortage])
                        : t('approvalFlow.summary.candidates', { count: result.candidates.length })}
                  </span>
                )}
              </button>
            </li>
          );
        })}
        <li className="flex items-stretch gap-2">
          <Arrow />
          <Endpoint icon="check" testId="approval-flow-summary-outcome">
            <span className="flex flex-col">
              <span>{t('approvalFlow.summary.outcome')}</span>
              <span className="text-xs text-[var(--color-fg-muted)]">{outcome}</span>
            </span>
          </Endpoint>
        </li>
      </ol>
      {preview && (
        <p className="m-0 mt-2 text-xs text-[var(--color-fg-muted)]">
          {t('approvalFlow.summary.previewHint')}
        </p>
      )}
    </section>
  );
}

function Arrow() {
  return (
    <span className="flex items-center text-[var(--color-fg-muted)]" aria-hidden>
      <Icon name="chevron-right" size={16} />
    </span>
  );
}

function Endpoint({
  icon,
  children,
  testId,
}: {
  icon: 'file-text' | 'check';
  children: ReactNode;
  testId?: string;
}) {
  return (
    <span
      className="flex max-w-56 items-center gap-2 rounded-md bg-[var(--color-fill-subtle)] px-3 py-2"
      data-testid={testId}
    >
      <Icon name={icon} size={16} />
      {children}
    </span>
  );
}
