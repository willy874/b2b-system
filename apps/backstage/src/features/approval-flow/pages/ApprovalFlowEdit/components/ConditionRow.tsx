import { IconButton } from '@b2b-system/ui/Button';
import { Icon } from '@b2b-system/ui/Icon';
import { Input } from '@b2b-system/ui/Input';
import { Select } from '@b2b-system/ui/Select';
import { useTranslation } from '@b2b-system/web-core/locales';

import type { ApprovalConditionField } from '@/shared/api-sdk';

import { APPROVAL_FLOW_FIELD_LABEL_KEY, CONDITION_OPERATOR_LABEL_KEY } from '../../../constants';
import {
  changeConditionField,
  changeConditionOperator,
  operatorsFor,
} from '../../../hooks/flowDraft';
import type { ConditionDraft } from '../../../hooks/flowDraft';

interface ConditionRowProps {
  value: ConditionDraft;
  fields: readonly ApprovalConditionField[];
  onChange: (value: ConditionDraft) => void;
  onRemove: () => void;
  readOnly: boolean;
  /** 前端驗證或後端 `VALIDATION_FAILED` 落在這一列的哪些部分。 */
  invalid: { field: boolean; op: boolean; value: boolean };
}

/** 條件列：欄位 → 運算子（跟著欄位型別）→ 值（列舉用下拉、其他用文字；`in` 可多個，D2）。 */
export function ConditionRow({
  value,
  fields,
  onChange,
  onRemove,
  readOnly,
  invalid,
}: ConditionRowProps) {
  const { t } = useTranslation();
  const field = fields.find((candidate) => candidate.key === value.field);
  const fieldLabel = (key: string) => {
    const labelKey = APPROVAL_FLOW_FIELD_LABEL_KEY[key];
    return labelKey ? t(labelKey) : key;
  };
  const operators = field ? operatorsFor(field.type) : [];
  const isList = value.op === 'in';

  return (
    <div
      className="flex flex-wrap items-center gap-2"
      data-testid="approval-flow-condition"
      data-value={value.field}
    >
      <Select
        className="w-40"
        size="sm"
        aria-label={t('approvalFlow.condition.field')}
        options={fields.map((candidate) => ({
          value: candidate.key,
          label: fieldLabel(candidate.key),
        }))}
        value={value.field}
        onValueChange={(key) => {
          const next = fields.find((candidate) => candidate.key === key);
          if (next) onChange(changeConditionField(value, next));
        }}
        disabled={readOnly}
        invalid={invalid.field}
        data-testid="approval-flow-condition-field"
      />
      <Select
        className="w-32"
        size="sm"
        aria-label={t('approvalFlow.condition.op.label')}
        options={operators.map((op) => ({ value: op, label: t(CONDITION_OPERATOR_LABEL_KEY[op]) }))}
        value={value.op}
        onValueChange={(op) => onChange(changeConditionOperator(value, op))}
        disabled={readOnly}
        invalid={invalid.op}
        data-testid="approval-flow-condition-op"
      />
      <div className="min-w-40 flex-1">
        {field?.type === 'enum' ? (
          isList ? (
            <Select
              multiple
              size="sm"
              aria-label={t('approvalFlow.condition.value')}
              options={(field.options ?? []).map((option) => ({ value: option, label: option }))}
              value={value.options}
              onValueChange={(options) => onChange({ ...value, options })}
              disabled={readOnly}
              invalid={invalid.value}
              data-testid="approval-flow-condition-value"
            />
          ) : (
            <Select
              size="sm"
              aria-label={t('approvalFlow.condition.value')}
              options={(field.options ?? []).map((option) => ({ value: option, label: option }))}
              value={value.options[0] ?? null}
              onValueChange={(option) => onChange({ ...value, options: [option] })}
              disabled={readOnly}
              invalid={invalid.value}
              data-testid="approval-flow-condition-value"
            />
          )
        ) : (
          <Input
            size="sm"
            aria-label={t('approvalFlow.condition.value')}
            inputMode={field?.type === 'number' && !isList ? 'decimal' : undefined}
            placeholder={
              isList
                ? t('approvalFlow.condition.listPlaceholder')
                : t('approvalFlow.condition.value')
            }
            value={value.text}
            onChange={(event) => onChange({ ...value, text: event.target.value })}
            disabled={readOnly}
            invalid={invalid.value}
            data-testid="approval-flow-condition-value"
          />
        )}
      </div>
      {!readOnly && (
        <IconButton
          size="sm"
          aria-label={t('approvalFlow.condition.remove')}
          onClick={onRemove}
          data-testid="approval-flow-condition-remove"
        >
          <Icon name="close" size={16} />
        </IconButton>
      )}
    </div>
  );
}
