import { Select as BaseSelect } from '@base-ui-components/react/select';
import type { CSSProperties, ReactNode } from 'react';

import { cn } from '@/shared/utils';

import { createSlots } from '../slots';
import type { SlotOverrides } from '../slots';

import styles from './Select.module.css';

export interface SelectOption<T extends string = string> {
  value: T;
  label: ReactNode;
  disabled?: boolean;
}

/**
 * `className` / `style` / `data-testid` / `aria-label` 落在觸發按鈕；
 * 其餘各層用 `classNames` / `styles` / `testIds` 覆寫。
 */
export type SelectSlot =
  | 'value'
  | 'icon'
  | 'positioner'
  | 'popup'
  | 'item'
  | 'indicator'
  | 'itemText';

export interface SelectProps<T extends string = string> extends SlotOverrides<SelectSlot> {
  value?: T | null;
  defaultValue?: T | null;
  onValueChange?: (value: T) => void;
  options: Array<SelectOption<T>>;
  placeholder?: string;
  disabled?: boolean;
  invalid?: boolean;
  size?: 'sm' | 'md';
  className?: string;
  style?: CSSProperties;
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
  classNames,
  styles: styleOverrides,
  testIds,
  ...rest
}: SelectProps<T>) {
  const slot = createSlots({ classNames, styles: styleOverrides, testIds });
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
        className={cn(styles.trigger, className)}
        data-size={size}
        aria-invalid={invalid || undefined}
        {...rest}
      >
        <BaseSelect.Value {...slot('value')}>
          {(selected: unknown) =>
            options.find((option) => option.value === selected)?.label ?? placeholder ?? ''
          }
        </BaseSelect.Value>
        <BaseSelect.Icon {...slot('icon', styles.icon)}>▾</BaseSelect.Icon>
      </BaseSelect.Trigger>
      <BaseSelect.Portal>
        <BaseSelect.Positioner sideOffset={4} {...slot('positioner', styles.positioner)}>
          <BaseSelect.Popup {...slot('popup', styles.popup)}>
            {options.map((option) => (
              <BaseSelect.Item
                key={option.value}
                value={option.value}
                disabled={option.disabled}
                {...slot('item', styles.item)}
                data-value={option.value}
              >
                <BaseSelect.ItemIndicator {...slot('indicator', styles.indicator)}>
                  ✓
                </BaseSelect.ItemIndicator>
                <BaseSelect.ItemText {...slot('itemText')}>{option.label}</BaseSelect.ItemText>
              </BaseSelect.Item>
            ))}
          </BaseSelect.Popup>
        </BaseSelect.Positioner>
      </BaseSelect.Portal>
    </BaseSelect.Root>
  );
}
