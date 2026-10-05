import { Button } from '@b2b-system/ui/Button';
import { isAppError, useErrorToast } from '@b2b-system/web-core/errors';
import { useTranslation } from '@b2b-system/web-core/locales';
import { useId, useState } from 'react';

import { useSettingDraft } from '../../../hooks/useSettingDraft';
import { useUpdateSettingsMutation } from '../../../hooks/useUpdateSettingsMutation';
import type { SettingCategoryView } from '../../../types';
import { SettingField } from './SettingField';

/** 後端欄位錯誤的路徑是 `values.<key>`（`ZodValidationPipe` 與 service 同一個形狀）。 */
const FIELD_PATH_PREFIX = 'values.';

interface SettingCategoryFormProps {
  view: SettingCategoryView;
  canUpdate: boolean;
}

/** 一個分類一張表單：只送出改過的 key，一次儲存。 */
export function SettingCategoryForm({ view, canUpdate }: SettingCategoryFormProps) {
  const { t } = useTranslation();
  const showError = useErrorToast();
  const update = useUpdateSettingsMutation();
  const draft = useSettingDraft(view.fields);
  const [serverErrors, setServerErrors] = useState<Record<string, string>>({});
  const headingId = useId();
  const hasErrors = Object.keys(draft.errors).length > 0;

  const save = async () => {
    setServerErrors({});
    try {
      await update.mutateAsync({ params: { values: draft.changes } });
      draft.clear();
    } catch (error) {
      const fields = isAppError(error) ? error.fieldErrors : undefined;
      if (!fields) return showError(error);
      // 後端的訊息是 Zod 的英文說明；畫面統一顯示「超出允許範圍」
      setServerErrors(
        Object.fromEntries(
          Object.keys(fields)
            .filter((path) => path.startsWith(FIELD_PATH_PREFIX))
            .map((path) => [path.slice(FIELD_PATH_PREFIX.length), t('setting.error.range')]),
        ),
      );
    }
  };

  return (
    <section
      className="rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface)] px-4"
      aria-labelledby={headingId}
      data-testid="setting-category"
      data-value={view.category}
    >
      <h2 id={headingId} className="m-0 pt-4 text-base font-medium">
        {t(view.labelKey)}
      </h2>
      {view.fields.map((field) => {
        const { value, isOverridden } = draft.current(field);
        return (
          <SettingField
            key={field.key}
            field={field}
            value={value}
            isOverridden={isOverridden}
            canUpdate={canUpdate}
            error={draft.errors[field.key]}
            serverError={serverErrors[field.key]}
            onChange={(next) => draft.setValue(field, next)}
            onReset={() => draft.resetToDefault(field)}
          />
        );
      })}
      {canUpdate && draft.isDirty && (
        <footer className="flex justify-end gap-2 border-t border-[var(--color-border)] py-3">
          <Button
            onClick={() => {
              draft.clear();
              setServerErrors({});
            }}
            data-testid="setting-discard"
          >
            {t('setting.discard')}
          </Button>
          <Button
            variant="primary"
            loading={update.isPending}
            disabled={hasErrors}
            onClick={save}
            data-testid="setting-save"
            data-value={view.category}
          >
            {t('common.save')}
          </Button>
        </footer>
      )}
    </section>
  );
}
