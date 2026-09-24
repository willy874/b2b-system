import { NumberField as BaseNumberField } from '@base-ui-components/react/number-field';
import { useId } from 'react';

import { cn } from '@/shared/utils';

import { Icon } from '../Icon';
import { createSlots } from '../slots';
import type { SlotOverrides } from '../slots';

import './NumberField.css';

/**
 * `className` 落在根元素，`data-testid` / `aria-label` 落在 `input`；
 * 其餘各層用 `classNames` / `styles` / `testIds` 覆寫。
 */
export type NumberFieldSlot = 'group' | 'decrement' | 'input' | 'increment';

export interface NumberFieldProps extends SlotOverrides<NumberFieldSlot> {
  value?: number | null;
  defaultValue?: number;
  onValueChange?: (value: number | null) => void;
  min?: number;
  max?: number;
  step?: number;
  disabled?: boolean;
  readOnly?: boolean;
  required?: boolean;
  invalid?: boolean;
  name?: string;
  placeholder?: string;
  format?: Intl.NumberFormatOptions;
  size?: 'sm' | 'md';
  className?: string;
  'aria-label'?: string;
  'data-testid'?: string;
  labels?: { increment: string; decrement: string };
}

/** 數字輸入：鍵盤上下鍵、滾輪與拖曳都由 Base UI 處理，我們只負責外觀。 */
export function NumberField({
  value,
  defaultValue,
  onValueChange,
  min,
  max,
  step = 1,
  disabled,
  readOnly,
  required,
  invalid,
  name,
  placeholder,
  format,
  size = 'md',
  className,
  labels = { increment: 'increase', decrement: 'decrease' },
  classNames,
  styles,
  testIds,
  ...rest
}: NumberFieldProps) {
  const slot = createSlots({ classNames, styles, testIds });
  const id = useId();

  return (
    <BaseNumberField.Root
      id={id}
      value={value}
      defaultValue={defaultValue}
      onValueChange={(next) => onValueChange?.(next)}
      min={min}
      max={max}
      step={step}
      disabled={disabled}
      readOnly={readOnly}
      required={required}
      name={name}
      format={format}
      className={cn('ge-number-field', className)}
    >
      <BaseNumberField.Group
        {...slot('group', [
          'ge-number-field__group',
          size === 'sm' && 'ge-number-field__group--sm',
        ])}
      >
        <BaseNumberField.Decrement
          {...slot('decrement', 'ge-number-field__button')}
          aria-label={labels.decrement}
        >
          <Icon name="minus" size={16} />
        </BaseNumberField.Decrement>
        <BaseNumberField.Input
          {...slot('input', 'ge-number-field__input')}
          placeholder={placeholder}
          aria-invalid={invalid || undefined}
          {...rest}
        />
        <BaseNumberField.Increment
          {...slot('increment', 'ge-number-field__button')}
          aria-label={labels.increment}
        >
          <Icon name="plus" size={16} />
        </BaseNumberField.Increment>
      </BaseNumberField.Group>
    </BaseNumberField.Root>
  );
}
