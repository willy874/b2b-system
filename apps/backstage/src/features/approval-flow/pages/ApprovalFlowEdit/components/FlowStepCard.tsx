import { Button, IconButton } from '@b2b-system/ui/Button';
import { Field } from '@b2b-system/ui/Field';
import { Icon } from '@b2b-system/ui/Icon';
import { Input } from '@b2b-system/ui/Input';
import { NumberField } from '@b2b-system/ui/NumberField';
import { Select } from '@b2b-system/ui/Select';
import { useTranslation } from '@b2b-system/web-core/locales';

import type { ApprovalConditionField, ApprovalFlow } from '@/shared/api-sdk';

import {
  APPROVAL_FLOW_MAX_CONDITIONS,
  APPROVAL_FLOW_MAX_REQUIRED,
  ASSIGNEE_KIND_LABEL_KEY,
} from '../../../constants';
import { addCondition, hasErrorAt, savedAssigneeStatus } from '../../../hooks/flowDraft';
import type { StepDraft } from '../../../hooks/flowDraft';
import type { AssigneeKindAvailability } from '../../../hooks/useAssigneeKindAvailability';
import { stepSummaryParts } from '../stepSummary';
import { AssigneeRuleEditor } from './AssigneeRuleEditor';
import type { AssigneeListAccess } from './AssigneeRuleEditor';
import { ConditionRow } from './ConditionRow';

interface FlowStepCardProps {
  step: StepDraft;
  index: number;
  total: number;
  fields: readonly ApprovalConditionField[];
  isAnonymous: boolean;
  availability: AssigneeKindAvailability;
  access: AssigneeListAccess;
  readOnly: boolean;
  /** 前端驗證與後端 `VALIDATION_FAILED` 的錯誤（`steps.1.conditions.0.value` 形式的路徑）。 */
  errors: Readonly<Record<string, string>>;
  /** 儲存時 `422 APPROVAL_FLOW_ASSIGNEE_UNAVAILABLE` 指到這一關。 */
  isAssigneeRejected: boolean;
  /** 展開成表單；收合時只有一行摘要。 */
  expanded: boolean;
  onToggle: () => void;
  /** 最後一關：說明它的審核者還需要核准這個類型的權限（D3）。 */
  requiredPermissions: ApprovalFlow['requiredPermissions'];
  onChange: (change: (step: StepDraft) => StepDraft) => void;
  onMove: (delta: -1 | 1) => void;
  onRemove: () => void;
}

/** 卡片的 DOM id：流程摘要點節點時捲到這裡。 */
export function stepCardElementId(stepId: string): string {
  return `approval-flow-step-${stepId}`;
}

/**
 * 一個關卡：名稱、審核者規則、同意數（數字或「全部」）、條件列（AND）。
 * 已儲存的關卡預設收合成一行摘要，點開才是表單（docs/architecture/backend/20-approval.md §9.16）。
 */
export function FlowStepCard({
  step,
  index,
  total,
  fields,
  isAnonymous,
  availability,
  access,
  readOnly,
  errors,
  isAssigneeRejected,
  expanded,
  onToggle,
  requiredPermissions,
  onChange,
  onMove,
  onRemove,
}: FlowStepCardProps) {
  const { t } = useTranslation();
  const summary = stepSummaryParts(step, t);
  const isLast = index === total - 1;
  const path = `steps.${index}`;
  const nameError = errors[`${path}.name`];
  const assigneeInvalid = isAssigneeRejected || hasErrorAt(errors, `${path}.assignee`);
  const savedStatus = savedAssigneeStatus(step);

  return (
    <li
      className="flex flex-col gap-3 rounded-md border border-[var(--color-border)] p-4 data-[invalid]:border-[var(--color-danger)]"
      data-invalid={isAssigneeRejected || hasErrorAt(errors, path) || undefined}
      id={stepCardElementId(step.id)}
      data-testid="approval-flow-step"
      data-value={index}
      data-expanded={expanded || undefined}
    >
      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          className="flex min-w-0 flex-1 items-start gap-2 border-0 bg-transparent p-0 text-start"
          aria-expanded={expanded}
          onClick={onToggle}
          data-testid="approval-flow-step-toggle"
        >
          <Icon
            name={expanded ? 'chevron-down' : 'chevron-right'}
            size={16}
            className="mt-0.5 shrink-0"
          />
          <span className="flex min-w-0 flex-col">
            <span className="text-sm font-semibold">
              {t('approvalFlow.step.ordinal', { ordinal: index + 1 })}
              {!expanded && ` · ${step.name.trim() || t('approvalFlow.summary.untitled')}`}
            </span>
            {!expanded && (
              <span
                className="text-xs text-[var(--color-fg-muted)]"
                data-testid="approval-flow-step-summary-line"
              >
                {[summary.assignee, summary.required, summary.conditions]
                  .filter(Boolean)
                  .join(' · ')}
              </span>
            )}
          </span>
        </button>
        {!readOnly && (
          <div className="flex gap-1">
            <IconButton
              size="sm"
              aria-label={t('approvalFlow.step.moveUp')}
              disabled={index === 0}
              onClick={() => onMove(-1)}
              data-testid="approval-flow-step-up"
            >
              <Icon name="arrow-up" size={16} />
            </IconButton>
            <IconButton
              size="sm"
              aria-label={t('approvalFlow.step.moveDown')}
              disabled={index === total - 1}
              onClick={() => onMove(1)}
              data-testid="approval-flow-step-down"
            >
              <Icon name="arrow-down" size={16} />
            </IconButton>
            <IconButton
              size="sm"
              aria-label={t('approvalFlow.step.remove')}
              disabled={total <= 1}
              onClick={onRemove}
              data-testid="approval-flow-step-remove"
            >
              <Icon name="trash" size={16} />
            </IconButton>
          </div>
        )}
      </div>

      {expanded && (
        <>
          <Field label={t('approvalFlow.step.name')} required error={nameError && t(nameError)}>
            <Input
              value={step.name}
              maxLength={64}
              disabled={readOnly}
              onChange={(event) =>
                onChange((current) => ({ ...current, name: event.target.value }))
              }
              data-testid="approval-flow-step-name"
            />
          </Field>

          <Field
            label={t('approvalFlow.step.assignee')}
            required
            error={
              isAssigneeRejected
                ? t('approvalFlow.assignee.rejected')
                : assigneeInvalid
                  ? t(errors[`${path}.assignee`] ?? 'validation.invalid')
                  : undefined
            }
          >
            {readOnly ? (
              <p className="m-0 text-sm" data-testid="approval-flow-assignee-summary">
                {t('approvalFlow.assignee.summary', {
                  kind: t(ASSIGNEE_KIND_LABEL_KEY[step.assignee.kind]),
                  target:
                    step.assignee.kind === 'manager'
                      ? t('approvalFlow.assignee.managerLevel', { level: step.assignee.level })
                      : (savedStatus?.label ?? '-'),
                })}
              </p>
            ) : (
              <AssigneeRuleEditor
                value={step.assignee}
                onChange={(assignee) => onChange((current) => ({ ...current, assignee }))}
                isAnonymous={isAnonymous}
                availability={availability}
                access={access}
                savedStatus={savedStatus}
                invalid={assigneeInvalid}
              />
            )}
          </Field>
          {isLast && requiredPermissions.length > 0 && (
            <p
              className="m-0 rounded-md bg-[var(--color-fill-subtle)] px-3 py-2 text-xs text-[var(--color-fg-muted)]"
              data-testid="approval-flow-step-permission-hint"
            >
              {t('approvalFlow.step.lastStepPermission', {
                permissions: requiredPermissions
                  .map((permission) => t(permission.nameI18nKey))
                  .join(t('approvalFlow.step.listSeparator')),
              })}
            </p>
          )}

          <Field label={t('approvalFlow.step.required')}>
            <div className="flex flex-wrap items-center gap-2">
              <Select
                className="w-40"
                aria-label={t('approvalFlow.step.requiredMode')}
                options={[
                  { value: 'count' as const, label: t('approvalFlow.step.requiredCount') },
                  { value: 'all' as const, label: t('approvalFlow.step.requiredAll') },
                ]}
                value={step.requiredMode}
                onValueChange={(requiredMode) =>
                  onChange((current) => ({ ...current, requiredMode }))
                }
                disabled={readOnly}
                data-testid="approval-flow-step-required-mode"
              />
              {step.requiredMode === 'count' && (
                <NumberField
                  className="w-28"
                  aria-label={t('approvalFlow.step.requiredCount')}
                  value={step.requiredCount}
                  min={1}
                  max={APPROVAL_FLOW_MAX_REQUIRED}
                  disabled={readOnly}
                  invalid={hasErrorAt(errors, `${path}.requiredApprovals`)}
                  onValueChange={(count) =>
                    onChange((current) => ({ ...current, requiredCount: count ?? 1 }))
                  }
                  labels={{
                    increment: t('approvalFlow.step.increase'),
                    decrement: t('approvalFlow.step.decrease'),
                  }}
                  data-testid="approval-flow-step-required-count"
                />
              )}
            </div>
            <p
              className="m-0 mt-1 text-xs text-[var(--color-fg-muted)]"
              data-testid="approval-flow-step-required-hint"
            >
              {step.requiredMode === 'all'
                ? t('approvalFlow.step.requiredAllHint')
                : t('approvalFlow.step.requiredCountHint', { count: step.requiredCount })}
            </p>
          </Field>

          <div className="flex flex-col gap-2">
            <span className="text-sm font-medium">{t('approvalFlow.step.conditions')}</span>
            {step.conditions.length === 0 && (
              <p className="m-0 text-sm text-[var(--color-fg-muted)]">
                {t('approvalFlow.step.noCondition')}
              </p>
            )}
            {step.conditions.map((condition, conditionIndex) => {
              const conditionPath = `${path}.conditions.${conditionIndex}`;
              return (
                <ConditionRow
                  key={condition.id}
                  value={condition}
                  fields={fields}
                  readOnly={readOnly}
                  invalid={{
                    field: hasErrorAt(errors, `${conditionPath}.field`),
                    op: hasErrorAt(errors, `${conditionPath}.op`),
                    value: hasErrorAt(errors, `${conditionPath}.value`),
                  }}
                  onChange={(next) =>
                    onChange((current) => ({
                      ...current,
                      conditions: current.conditions.map((item) =>
                        item.id === condition.id ? next : item,
                      ),
                    }))
                  }
                  onRemove={() =>
                    onChange((current) => ({
                      ...current,
                      conditions: current.conditions.filter((item) => item.id !== condition.id),
                    }))
                  }
                />
              );
            })}
            {!readOnly && fields.length > 0 && (
              <div>
                <Button
                  size="sm"
                  variant="ghost"
                  startIcon={<Icon name="plus" size={16} />}
                  disabled={step.conditions.length >= APPROVAL_FLOW_MAX_CONDITIONS}
                  onClick={() => onChange((current) => addCondition(current, fields))}
                  data-testid="approval-flow-condition-add"
                >
                  {t('approvalFlow.condition.add')}
                </Button>
              </div>
            )}
          </div>
        </>
      )}
    </li>
  );
}
