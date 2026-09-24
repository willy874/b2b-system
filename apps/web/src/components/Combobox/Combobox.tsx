import { Combobox as BaseCombobox } from '@base-ui-components/react/combobox';
import type { ReactNode } from 'react';

import { cn } from '@/shared/utils';

import { Icon } from '../Icon';
import { createSlots } from '../slots';
import type { SlotOverrides } from '../slots';

import styles from './Combobox.module.css';

export interface ComboboxOption<T extends string = string> {
  value: T;
  label: string;
  description?: ReactNode;
  disabled?: boolean;
}

/**
 * `className` 落在外框（包住輸入框與按鈕），`data-testid` / `aria-label` 落在 `input`；
 * 其餘各層用 `classNames` / `styles` / `testIds` 覆寫。
 */
export type ComboboxSlot =
  | 'input'
  | 'trigger'
  | 'positioner'
  | 'popup'
  | 'empty'
  | 'list'
  | 'item'
  | 'indicator'
  | 'itemText'
  | 'itemDescription';

export interface ComboboxProps<T extends string = string> extends SlotOverrides<ComboboxSlot> {
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
  classNames,
  styles: styleOverrides,
  testIds,
  ...rest
}: ComboboxProps<T>) {
  const slot = createSlots({ classNames, styles: styleOverrides, testIds });
  // Base UI 的值是 items 裡的選項物件；對外的 props 只用選項的 value 字串，在這裡互轉。
  // `value === undefined` 維持非受控；受控時 `null` 代表沒有選取。
  const findOption = (key: T | null | undefined) =>
    key === undefined ? undefined : (options.find((option) => option.value === key) ?? null);
  return (
    <BaseCombobox.Root
      items={options}
      value={findOption(value)}
      defaultValue={findOption(defaultValue)}
      onValueChange={(next: unknown) =>
        onValueChange?.((next as ComboboxOption<T> | null)?.value ?? null)
      }
      disabled={disabled}
      itemToStringLabel={(item: unknown) => (item as ComboboxOption).label}
    >
      <div className={cn(styles.root, className)}>
        <BaseCombobox.Input
          {...slot('input', styles.input)}
          placeholder={placeholder}
          aria-invalid={invalid || undefined}
          {...rest}
        />
        <BaseCombobox.Trigger {...slot('trigger', styles.trigger)} aria-label="open">
          <Icon name="chevron-down" size={16} />
        </BaseCombobox.Trigger>
      </div>

      <BaseCombobox.Portal>
        <BaseCombobox.Positioner sideOffset={4} {...slot('positioner', styles.positioner)}>
          <BaseCombobox.Popup {...slot('popup', styles.popup)}>
            <BaseCombobox.Empty {...slot('empty', styles.empty)}>{emptyMessage}</BaseCombobox.Empty>
            <BaseCombobox.List {...slot('list')}>
              {(item: ComboboxOption<T>) => (
                <BaseCombobox.Item
                  key={item.value}
                  value={item}
                  disabled={item.disabled}
                  {...slot('item', styles.item, { testId: 'combobox-item' })}
                  data-value={item.value}
                >
                  {/* 常駐佔位、未選取時以 CSS 隱藏；否則選取瞬間插入 ✓ 會把文字往右推。 */}
                  <BaseCombobox.ItemIndicator keepMounted {...slot('indicator', styles.indicator)}>
                    <Icon name="check" size={14} />
                  </BaseCombobox.ItemIndicator>
                  <span {...slot('itemText', styles.itemText)}>
                    <span>{item.label}</span>
                    {item.description && (
                      <span {...slot('itemDescription', styles.itemDescription)}>
                        {item.description}
                      </span>
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
