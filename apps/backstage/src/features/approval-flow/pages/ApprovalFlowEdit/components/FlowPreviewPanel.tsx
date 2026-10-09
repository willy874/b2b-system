import { Button } from '@b2b-system/ui/Button';
import { Chip } from '@b2b-system/ui/Chip';
import { Field } from '@b2b-system/ui/Field';
import { FormError } from '@b2b-system/ui/FormError';
import { Input } from '@b2b-system/ui/Input';
import { Select } from '@b2b-system/ui/Select';
import { useErrorMessage } from '@b2b-system/web-core/errors';
import { useTranslation } from '@b2b-system/web-core/locales';

import type { ApprovalConditionField } from '@/shared/api-sdk';

import { UserSearchSelect } from '../../../components/UserSearchSelect';
import { APPROVAL_FLOW_FIELD_LABEL_KEY, PREVIEW_SHORTAGE_LABEL_KEY } from '../../../constants';
import type { FlowPreviewState } from '../useFlowPreview';

interface FlowPreviewPanelProps {
  preview: FlowPreviewState;
  fields: readonly ApprovalConditionField[];
  isAnonymous: boolean;
  /** 讀得到使用者才能選申請人。 */
  canSearchUsers: boolean;
}

/**
 * 試算（docs/architecture/backend/20-approval.md §9.13、§9.16）：給定申請人與欄位值，以 **未儲存的草稿** 預覽每一關會不會略過、
 * 候選人是誰、需要幾人、有沒有短缺。修改後自動重算（`useFlowPreview`）；唯讀，不必有 `approvalFlow:update`。
 */
export function FlowPreviewPanel({
  preview,
  fields,
  isAnonymous,
  canSearchUsers,
}: FlowPreviewPanelProps) {
  const { t } = useTranslation();
  const toMessage = useErrorMessage();

  const fieldLabel = (key: string) => {
    const labelKey = APPROVAL_FLOW_FIELD_LABEL_KEY[key];
    return labelKey ? t(labelKey) : key;
  };

  return (
    <section
      className="flex flex-col gap-3 rounded-md border border-[var(--color-border)] p-4"
      data-testid="approval-flow-preview"
    >
      <div>
        <h2 className="m-0 text-base font-semibold">{t('approvalFlow.preview.title')}</h2>
        <p className="mt-1 mb-0 text-sm text-[var(--color-fg-muted)]">
          {t('approvalFlow.preview.description')}
        </p>
      </div>
      {!isAnonymous && canSearchUsers && (
        <Field label={t('approvalFlow.preview.requester')}>
          <UserSearchSelect
            aria-label={t('approvalFlow.preview.requester')}
            value={preview.requesterId}
            onChange={preview.setRequesterId}
            data-testid="approval-flow-preview-requester"
          />
        </Field>
      )}
      {fields.map((field) => (
        <Field key={field.key} label={fieldLabel(field.key)}>
          {field.type === 'enum' ? (
            <Select
              aria-label={fieldLabel(field.key)}
              options={(field.options ?? []).map((option) => ({ value: option, label: option }))}
              value={preview.inputs[field.key] || null}
              onValueChange={(option) => preview.setInput(field.key, option)}
              data-testid="approval-flow-preview-field"
            />
          ) : (
            <Input
              aria-label={fieldLabel(field.key)}
              inputMode={field.type === 'number' ? 'decimal' : undefined}
              value={preview.inputs[field.key] ?? ''}
              onChange={(event) => preview.setInput(field.key, event.target.value)}
              data-testid="approval-flow-preview-field"
              data-value={field.key}
            />
          )}
        </Field>
      ))}
      <div className="flex items-center gap-2">
        <Button
          size="sm"
          onClick={preview.run}
          disabled={preview.incomplete}
          loading={preview.isPending}
          data-testid="approval-flow-preview-run"
        >
          {t('approvalFlow.preview.run')}
        </Button>
        <span className="text-xs text-[var(--color-fg-muted)]">
          {t('approvalFlow.preview.auto')}
        </span>
      </div>
      {preview.incomplete && (
        <p
          className="m-0 text-sm text-[var(--color-fg-muted)]"
          data-testid="approval-flow-preview-incomplete"
        >
          {t('approvalFlow.preview.incomplete')}
        </p>
      )}
      <FormError data-testid="approval-flow-preview-error">
        {preview.error ? toMessage(preview.error) : undefined}
      </FormError>
      {preview.result && (
        <ol
          className="m-0 flex list-none flex-col gap-2 p-0"
          data-testid="approval-flow-preview-result"
        >
          {preview.result.steps.map((step, index) => (
            <li
              key={step.key}
              className="flex flex-col gap-1 rounded-md bg-[var(--color-fill-subtle)] p-3 text-sm"
              data-testid="approval-flow-preview-step"
              data-value={index}
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium">
                  {t('approvalFlow.preview.stepTitle', { ordinal: index + 1, name: step.name })}
                </span>
                {step.skipped && (
                  <Chip data-testid="approval-flow-preview-skipped">
                    {t('approvalFlow.preview.skipped')}
                  </Chip>
                )}
                {step.shortage && (
                  <Chip
                    tone="warning"
                    data-testid="approval-flow-preview-shortage"
                    data-value={step.shortage}
                  >
                    {t(PREVIEW_SHORTAGE_LABEL_KEY[step.shortage])}
                  </Chip>
                )}
              </div>
              {!step.skipped && (
                <>
                  <span
                    className="flex flex-wrap gap-1"
                    data-testid="approval-flow-preview-candidates"
                  >
                    {step.candidates.length > 0
                      ? step.candidates.map((candidate) => (
                          <Chip key={candidate.userId}>{candidate.name}</Chip>
                        ))
                      : t('approvalFlow.preview.noCandidate')}
                  </span>
                  {step.required !== null && (
                    <span className="text-[var(--color-fg-muted)]">
                      {t('approvalFlow.preview.required', { count: step.required })}
                    </span>
                  )}
                </>
              )}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
