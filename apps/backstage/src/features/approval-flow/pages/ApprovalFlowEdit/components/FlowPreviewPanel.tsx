import { Button } from '@b2b-system/ui/Button';
import { Chip } from '@b2b-system/ui/Chip';
import { Field } from '@b2b-system/ui/Field';
import { FormError } from '@b2b-system/ui/FormError';
import { Input } from '@b2b-system/ui/Input';
import { Select } from '@b2b-system/ui/Select';
import { useErrorMessage } from '@b2b-system/web-core/errors';
import { useTranslation } from '@b2b-system/web-core/locales';
import { useState } from 'react';

import type { ApprovalConditionField, PreviewApprovalFlowRequest } from '@/shared/api-sdk';

import { UserSearchSelect } from '../../../components/UserSearchSelect';
import { APPROVAL_FLOW_FIELD_LABEL_KEY, PREVIEW_SHORTAGE_LABEL_KEY } from '../../../constants';
import { toStepInputs } from '../../../hooks/flowDraft';
import type { FlowDraft } from '../../../hooks/flowDraft';
import { useApprovalFlowPreviewMutation } from '../../../hooks/useApprovalFlowMutations';

interface FlowPreviewPanelProps {
  type: string;
  draft: FlowDraft;
  fields: readonly ApprovalConditionField[];
  isAnonymous: boolean;
  /** 讀得到使用者才能選申請人。 */
  canSearchUsers: boolean;
}

/** 欄位的輸入 → 試算的值：數字欄位轉數字（格式不對當成沒填），空白當成沒填（條件不成立）。 */
function toFieldValues(
  fields: readonly ApprovalConditionField[],
  inputs: Readonly<Record<string, string>>,
): PreviewApprovalFlowRequest['fields'] {
  const values: PreviewApprovalFlowRequest['fields'] = {};
  for (const field of fields) {
    const text = inputs[field.key]?.trim() ?? '';
    if (!text) values[field.key] = null;
    else if (field.type === 'number') {
      const number = Number(text);
      values[field.key] = Number.isFinite(number) ? number : null;
    } else values[field.key] = text;
  }
  return values;
}

/**
 * 試算（docs/architecture/backend/20-approval.md §9.13）：給定申請人與欄位值，以 **未儲存的草稿** 預覽每一關會不會略過、
 * 候選人是誰、需要幾人、有沒有短缺。唯讀，不必有 `approvalFlow:update`。
 */
export function FlowPreviewPanel({
  type,
  draft,
  fields,
  isAnonymous,
  canSearchUsers,
}: FlowPreviewPanelProps) {
  const { t } = useTranslation();
  const toMessage = useErrorMessage();
  const preview = useApprovalFlowPreviewMutation();
  const [requesterId, setRequesterId] = useState<string | null>(null);
  const [inputs, setInputs] = useState<Record<string, string>>({});
  const [incomplete, setIncomplete] = useState(false);

  const run = () => {
    const steps = toStepInputs(draft.steps, fields);
    setIncomplete(!steps);
    if (!steps) {
      preview.reset();
      return;
    }
    preview.mutate({
      params: {
        type,
        body: {
          steps,
          allowRepeatApprover: draft.allowRepeatApprover,
          requesterId: isAnonymous ? null : requesterId,
          fields: toFieldValues(fields, inputs),
        },
      },
    });
  };

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
            value={requesterId}
            onChange={setRequesterId}
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
              value={inputs[field.key] || null}
              onValueChange={(option) => setInputs({ ...inputs, [field.key]: option })}
              data-testid="approval-flow-preview-field"
            />
          ) : (
            <Input
              aria-label={fieldLabel(field.key)}
              inputMode={field.type === 'number' ? 'decimal' : undefined}
              value={inputs[field.key] ?? ''}
              onChange={(event) => setInputs({ ...inputs, [field.key]: event.target.value })}
              data-testid="approval-flow-preview-field"
              data-value={field.key}
            />
          )}
        </Field>
      ))}
      <div>
        <Button
          variant="primary"
          size="sm"
          onClick={run}
          loading={preview.isPending}
          data-testid="approval-flow-preview-run"
        >
          {t('approvalFlow.preview.run')}
        </Button>
      </div>
      <FormError data-testid="approval-flow-preview-error">
        {incomplete
          ? t('approvalFlow.preview.incomplete')
          : preview.error
            ? toMessage(preview.error)
            : undefined}
      </FormError>
      {preview.data && !incomplete && (
        <ol
          className="m-0 flex list-none flex-col gap-2 p-0"
          data-testid="approval-flow-preview-result"
        >
          {preview.data.steps.map((step, index) => (
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
