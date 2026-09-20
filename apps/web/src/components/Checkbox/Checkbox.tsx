import { Checkbox as BaseCheckbox } from '@base-ui-components/react/checkbox';
import type { ReactNode } from 'react';

import { cn } from '@/shared/utils';

import './Checkbox.css';

export interface CheckboxProps {
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
  ...rest
}: CheckboxProps) {
  const control = (
    <BaseCheckbox.Root
      checked={checked}
      defaultChecked={defaultChecked}
      indeterminate={indeterminate}
      onCheckedChange={onCheckedChange}
      disabled={disabled}
      className="ge-checkbox__control"
      {...rest}
    >
      <BaseCheckbox.Indicator className="ge-checkbox__indicator">
        {indeterminate ? '–' : '✓'}
      </BaseCheckbox.Indicator>
    </BaseCheckbox.Root>
  );

  if (!label) return <span className={cn('ge-checkbox', className)}>{control}</span>;

  return (
    <label className={cn('ge-checkbox', 'ge-checkbox--labeled', className)}>
      {control}
      <span className="ge-checkbox__text">
        <span className="ge-checkbox__label">{label}</span>
        {description && <span className="ge-checkbox__description">{description}</span>}
      </span>
    </label>
  );
}
