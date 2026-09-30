import { useCallback, useMemo, useState } from 'react';

import type { SettingFieldView, SettingValue } from '../types';

/** 草稿裡的 `null` 代表「還原預設」，與 `PATCH /system/settings` 的語意相同。 */
type Draft = Readonly<Record<string, SettingValue | null>>;

function without(draft: Draft, key: string): Draft {
  return Object.fromEntries(Object.entries(draft).filter(([entry]) => entry !== key));
}

export type SettingFieldError = 'required' | 'integer' | 'range';

/** 數值的範圍檢查（存的值）；後端仍會再驗一次，這裡只是讓錯誤早一點出現。 */
export function validateSettingValue(
  field: SettingFieldView,
  value: SettingValue | null,
): SettingFieldError | undefined {
  if (value === null || field.type !== 'number') return undefined;
  if (typeof value !== 'number' || Number.isNaN(value)) return 'required';
  if (!Number.isInteger(value)) return 'integer';
  if (field.minimum !== null && value < field.minimum) return 'range';
  if (field.maximum !== null && value > field.maximum) return 'range';
  return undefined;
}

/**
 * 一個分類的編輯草稿：只記「和伺服器不同」的 key，送出時整包當 `values`。
 * 改回伺服器上的值或還原一個沒有覆寫的設定時，那個 key 從草稿移除，不會送出沒有變化的修改。
 */
export function useSettingDraft(fields: readonly SettingFieldView[]) {
  const [draft, setDraft] = useState<Draft>({});

  const setValue = useCallback((field: SettingFieldView, value: SettingValue) => {
    setDraft((prev) =>
      Object.is(value, field.value) ? without(prev, field.key) : { ...prev, [field.key]: value },
    );
  }, []);

  const resetToDefault = useCallback((field: SettingFieldView) => {
    setDraft((prev) =>
      field.isOverridden ? { ...prev, [field.key]: null } : without(prev, field.key),
    );
  }, []);

  const clear = useCallback(() => setDraft({}), []);

  /** 畫面上要顯示的值與是否覆寫（套用草稿之後）。 */
  const current = useCallback(
    (field: SettingFieldView): { value: SettingValue; isOverridden: boolean } => {
      if (!(field.key in draft)) return { value: field.value, isOverridden: field.isOverridden };
      const next = draft[field.key];
      return next === null || next === undefined
        ? { value: field.defaultValue, isOverridden: false }
        : { value: next, isOverridden: true };
    },
    [draft],
  );

  const errors = useMemo(() => {
    const result: Record<string, SettingFieldError> = {};
    for (const field of fields) {
      if (!(field.key in draft)) continue;
      const error = validateSettingValue(field, draft[field.key] ?? null);
      if (error) result[field.key] = error;
    }
    return result;
  }, [draft, fields]);

  return {
    changes: draft,
    isDirty: Object.keys(draft).length > 0,
    errors,
    current,
    setValue,
    resetToDefault,
    clear,
  };
}
