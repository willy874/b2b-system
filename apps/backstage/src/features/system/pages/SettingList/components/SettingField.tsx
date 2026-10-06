import { Button } from '@b2b-system/ui/Button';
import { Field } from '@b2b-system/ui/Field';
import { NumberField } from '@b2b-system/ui/NumberField';
import { Select } from '@b2b-system/ui/Select';
import { Switch } from '@b2b-system/ui/Switch';
import { useTranslation } from '@b2b-system/web-core/locales';
import { useMemo } from 'react';

import type { SettingFieldError } from '../../../hooks/useSettingDraft';
import type { SettingFieldView, SettingValue } from '../../../types';
import { toDisplayNumber, toRawNumber } from '../adapter';

const FIELD_ERROR_KEY = {
  required: 'setting.error.required',
  integer: 'setting.error.integer',
  range: 'setting.error.range',
} as const satisfies Record<SettingFieldError, string>;

/** 瀏覽器支援的 IANA 時區；目前的值不在清單裡（例：瀏覽器較舊）時也要選得到。 */
function timezoneOptions(current: string): Array<{ value: string; label: string }> {
  const zones = new Set(Intl.supportedValuesOf('timeZone'));
  zones.add(current);
  return [...zones].map((zone) => ({ value: zone, label: zone }));
}

interface SettingFieldProps {
  field: SettingFieldView;
  value: SettingValue;
  isOverridden: boolean;
  canUpdate: boolean;
  /** 前端的範圍檢查。 */
  error?: SettingFieldError;
  /** 後端回的欄位錯誤（已翻譯）。 */
  serverError?: string;
  onChange: (value: SettingValue) => void;
  onReset: () => void;
}

export function SettingField({
  field,
  value,
  isOverridden,
  canUpdate,
  error,
  serverError,
  onChange,
  onReset,
}: SettingFieldProps) {
  const { t } = useTranslation();
  const label = field.labelKey ? t(field.labelKey) : field.key;
  const unitLabel = field.unit ? t(field.unit.labelKey) : undefined;

  const formatValue = (raw: SettingValue): string => {
    if (typeof raw === 'boolean') return raw ? t('setting.boolean.on') : t('setting.boolean.off');
    if (typeof raw === 'number') {
      const display = toDisplayNumber(raw, field.unit);
      return unitLabel ? `${display} ${unitLabel}` : String(display);
    }
    return raw;
  };

  const range =
    field.type === 'number' && field.minimum !== null && field.maximum !== null
      ? t('setting.range', {
          min: formatValue(field.minimum),
          max: formatValue(field.maximum),
        })
      : undefined;

  const timezones = useMemo(
    () => (field.input === 'timezone' ? timezoneOptions(String(value)) : []),
    [field.input, value],
  );

  const control = (() => {
    if (field.type === 'boolean') {
      return (
        <Switch
          checked={value === true}
          onCheckedChange={onChange}
          disabled={!canUpdate}
          aria-label={label}
          data-testid="setting-switch"
        />
      );
    }
    if (field.type === 'number') {
      return (
        <div className="flex items-center gap-2">
          <NumberField
            value={
              typeof value === 'number' && !Number.isNaN(value)
                ? toDisplayNumber(value, field.unit)
                : null
            }
            onValueChange={(next) =>
              onChange(next === null ? Number.NaN : toRawNumber(next, field.unit))
            }
            min={field.minimum === null ? undefined : toDisplayNumber(field.minimum, field.unit)}
            max={field.maximum === null ? undefined : toDisplayNumber(field.maximum, field.unit)}
            readOnly={!canUpdate}
            invalid={Boolean(error ?? serverError)}
            size="sm"
            className="w-40"
            labels={{ increment: t('setting.increment'), decrement: t('setting.decrement') }}
            data-testid="setting-number-input"
          />
          {unitLabel && <span className="text-sm text-[var(--color-fg-muted)]">{unitLabel}</span>}
        </div>
      );
    }
    if (field.input === 'timezone') {
      return (
        <Select
          value={String(value)}
          onValueChange={onChange}
          options={timezones}
          searchable
          disabled={!canUpdate}
          className="w-72"
        />
      );
    }
    return <span className="text-sm">{String(value)}</span>;
  })();

  return (
    <div
      className="flex flex-col gap-1 border-t border-[var(--color-border)] py-4 first:border-t-0"
      data-testid="setting-field"
      data-value={field.key}
    >
      <Field
        label={label}
        description={field.descriptionKey ? t(field.descriptionKey) : undefined}
        error={serverError ?? (error ? t(FIELD_ERROR_KEY[error]) : undefined)}
      >
        {control}
      </Field>
      <div className="flex flex-wrap items-center gap-2 text-xs text-[var(--color-fg-muted)]">
        <span>{t('setting.defaultValue', { value: formatValue(field.defaultValue) })}</span>
        {range && <span>· {range}</span>}
        {isOverridden && (
          <span
            className="rounded bg-[var(--color-fill-subtle)] px-1"
            data-testid="setting-overridden"
          >
            {t('setting.overridden')}
          </span>
        )}
        {isOverridden && canUpdate && (
          <Button
            size="sm"
            variant="ghost"
            onClick={onReset}
            data-testid="setting-reset"
            data-value={field.key}
          >
            {t('setting.resetToDefault')}
          </Button>
        )}
      </div>
    </div>
  );
}
