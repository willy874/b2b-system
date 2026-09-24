import { Checkbox as BaseCheckbox } from '@base-ui-components/react/checkbox';
import type { ReactNode } from 'react';

import { cn } from '@/shared/utils';

import { createSlots } from '../slots';
import type { SlotOverrides } from '../slots';

import './Checkbox.css';

/**
 * `className` 落在最外層（`<label>` 或 `<span>`），`data-testid` / `aria-label` 落在 `control`；
 * 其餘各層用 `classNames` / `styles` / `testIds` 覆寫。
 */
export type CheckboxSlot = 'control' | 'indicator' | 'text' | 'label' | 'description';

export interface CheckboxProps extends SlotOverrides<CheckboxSlot> {
  checked?: boolean;
  defaultChecked?: boolean;
  indeterminate?: boolean;
  onCheckedChange?: (checked: boolean) => void;
  disabled?: boolean;
  label?: ReactNode;
  description?: ReactNode;
  className?: string;
  'aria-label'?: string;
  'data-testid'?: string;
}

export function Checkbox({
  checked,
  defaultChecked,
  indeterminate,
  onCheckedChange,
  disabled,
  label,
  description,
  className,
  classNames,
  styles,
  testIds,
  ...rest
}: CheckboxProps) {
  const slot = createSlots({ classNames, styles, testIds });
  const control = (
    <BaseCheckbox.Root
      checked={checked}
      defaultChecked={defaultChecked}
      indeterminate={indeterminate}
      onCheckedChange={onCheckedChange}
      disabled={disabled}
      {...slot('control', 'ge-checkbox__control')}
      {...rest}
    >
      <BaseCheckbox.Indicator {...slot('indicator', 'ge-checkbox__indicator')}>
        {indeterminate ? '–' : '✓'}
      </BaseCheckbox.Indicator>
    </BaseCheckbox.Root>
  );

  if (!label) return <span className={cn('ge-checkbox', className)}>{control}</span>;

  return (
    <label className={cn('ge-checkbox', 'ge-checkbox--labeled', className)}>
      {control}
      <span {...slot('text', 'ge-checkbox__text')}>
        <span {...slot('label', 'ge-checkbox__label')}>{label}</span>
        {description && (
          <span {...slot('description', 'ge-checkbox__description')}>{description}</span>
        )}
      </span>
    </label>
  );
}
