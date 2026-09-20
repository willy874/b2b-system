import { Select as BaseSelect } from '@base-ui-components/react/select';
import type { ReactNode } from 'react';

import { cn } from '@/shared/utils';

import './Select.css';

export interface SelectOption<T extends string = string> {
  value: T;
  label: ReactNode;
  disabled?: boolean;
}

export interface SelectProps<T extends string = string> {
  value?: T | null;
  defaultValue?: T | null;
  onValueChange?: (value: T) => void;
  options: Array<SelectOption<T>>;
  placeholder?: string;
  disabled?: boolean;
  invalid?: boolean;
  size?: 'sm' | 'md';
  className?: string;
  'aria-label'?: string;
  'data-testid'?: string;
}

export function Select<T extends string = string>({
  value,
  defaultValue,
  onValueChange,
  options,
  placeholder,
  disabled,
  invalid,
  size = 'md',
  className,
  ...rest
}: SelectProps<T>) {
  return (
    <BaseSelect.Root
      value={value as string}
      defaultValue={defaultValue as string}
      onValueChange={(next: string | null) => {
        if (next !== null) onValueChange?.(next as T);
      }}
      disabled={disabled}
      items={options.map((option) => ({ value: option.value, label: option.label }))}
    >
      <BaseSelect.Trigger
        className={cn('ge-select__trigger', size === 'sm' && 'ge-select__trigger--sm', className)}
        aria-invalid={invalid || undefined}
        {...rest}
      >
        <BaseSelect.Value>
          {(selected: unknown) =>
            options.find((option) => option.value === selected)?.label ?? placeholder ?? ''
          }
        </BaseSelect.Value>
        <BaseSelect.Icon className="ge-select__icon">▾</BaseSelect.Icon>
      </BaseSelect.Trigger>
      <BaseSelect.Portal>
        <BaseSelect.Positioner sideOffset={4} className="ge-select__positioner">
          <BaseSelect.Popup className="ge-select__popup">
            {options.map((option) => (
              <BaseSelect.Item
                key={option.value}
                value={option.value}
                disabled={option.disabled}
                className="ge-select__item"
              >
                <BaseSelect.ItemIndicator className="ge-select__indicator">
                  ✓
                </BaseSelect.ItemIndicator>
                <BaseSelect.ItemText>{option.label}</BaseSelect.ItemText>
              </BaseSelect.Item>
            ))}
          </BaseSelect.Popup>
        </BaseSelect.Positioner>
      </BaseSelect.Portal>
    </BaseSelect.Root>
  );
}
