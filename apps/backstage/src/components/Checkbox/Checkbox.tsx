import { Checkbox as BaseCheckbox } from '@base-ui-components/react/checkbox';
import type { ReactNode } from 'react';

import { cn } from '@/shared/utils';

import { Icon } from '../Icon';
import { createSlots } from '../slots';
import type { SlotOverrides } from '../slots';

import styles from './Checkbox.module.css';

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
  styles: styleOverrides,
  testIds,
  ...rest
}: CheckboxProps) {
  const slot = createSlots({ classNames, styles: styleOverrides, testIds });
  const control = (
    <BaseCheckbox.Root
      checked={checked}
      defaultChecked={defaultChecked}
      indeterminate={indeterminate}
      onCheckedChange={onCheckedChange}
      disabled={disabled}
      {...slot('control', styles.control)}
      {...rest}
    >
      <BaseCheckbox.Indicator {...slot('indicator', styles.indicator)}>
        <Icon name={indeterminate ? 'minus' : 'check'} size={14} />
      </BaseCheckbox.Indicator>
    </BaseCheckbox.Root>
  );

  if (!label) return <span className={cn(styles.root, className)}>{control}</span>;

  return (
    <label className={cn(styles.root, className)} data-labeled>
      {control}
      <span {...slot('text', styles.text)}>
        <span {...slot('label', styles.label)}>{label}</span>
        {description && <span {...slot('description', styles.description)}>{description}</span>}
      </span>
    </label>
  );
}
