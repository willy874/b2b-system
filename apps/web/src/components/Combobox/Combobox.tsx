import { Combobox as BaseCombobox } from '@base-ui-components/react/combobox';
import type { ReactNode } from 'react';

import { cn } from '@/shared/utils';

import { Icon } from '../Icon';

import './Combobox.css';

export interface ComboboxOption<T extends string = string> {
  value: T;
  label: string;
  description?: ReactNode;
  disabled?: boolean;
}

export interface ComboboxProps<T extends string = string> {
  value?: T | null;
  defaultValue?: T | null;
  onValueChange?: (value: T | null) => void;
  options: Array<ComboboxOption<T>>;
  placeholder?: string;
  emptyMessage?: string;
  disabled?: boolean;
  invalid?: boolean;
  className?: string;
  'aria-label'?: string;
  'data-testid'?: string;
}

/** 可搜尋的單選下拉。選項多的時候用它，少的時候用 `Select`。 */
export function Combobox<T extends string = string>({
  value,
  defaultValue,
  onValueChange,
  options,
  placeholder,
  emptyMessage = '沒有符合的項目',
  disabled,
  invalid,
  className,
  ...rest
}: ComboboxProps<T>) {
  return (
    <BaseCombobox.Root
      items={options}
      value={value ?? undefined}
      defaultValue={defaultValue ?? undefined}
      onValueChange={(next: unknown) => onValueChange?.((next ?? null) as T | null)}
      disabled={disabled}
      itemToStringLabel={(item: unknown) => (item as ComboboxOption).label}
    >
      <div className={cn('ge-combobox', className)}>
        <BaseCombobox.Input
          className="ge-combobox__input"
          placeholder={placeholder}
          aria-invalid={invalid || undefined}
          {...rest}
        />
        <BaseCombobox.Trigger className="ge-combobox__trigger" aria-label="open">
          <Icon name="chevron-down" size={16} />
        </BaseCombobox.Trigger>
      </div>

      <BaseCombobox.Portal>
        <BaseCombobox.Positioner sideOffset={4} className="ge-combobox__positioner">
          <BaseCombobox.Popup className="ge-combobox__popup">
            <BaseCombobox.Empty className="ge-combobox__empty">{emptyMessage}</BaseCombobox.Empty>
            <BaseCombobox.List>
              {(item: ComboboxOption<T>) => (
                <BaseCombobox.Item
                  key={item.value}
                  value={item}
                  disabled={item.disabled}
                  className="ge-combobox__item"
                  data-testid={`combobox-item-${item.value}`}
                >
                  <BaseCombobox.ItemIndicator className="ge-combobox__indicator">
                    <Icon name="check" size={14} />
                  </BaseCombobox.ItemIndicator>
                  <span className="ge-combobox__item-text">
                    <span>{item.label}</span>
                    {item.description && (
                      <span className="ge-combobox__item-description">{item.description}</span>
                    )}
                  </span>
                </BaseCombobox.Item>
              )}
            </BaseCombobox.List>
          </BaseCombobox.Popup>
        </BaseCombobox.Positioner>
      </BaseCombobox.Portal>
    </BaseCombobox.Root>
  );
}
