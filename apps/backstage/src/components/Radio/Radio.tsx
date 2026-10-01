import { Radio as BaseRadio } from '@base-ui/react/radio';
import { RadioGroup as BaseRadioGroup } from '@base-ui/react/radio-group';
import type { ReactNode } from 'react';

import { cn } from '@/shared/utils';

import { createSlots } from '../slots';
import type { SlotOverrides } from '../slots';

import styles from './Radio.module.css';

export type RadioGroupOrientation = 'vertical' | 'horizontal';

export interface RadioOption<T extends string = string> {
  value: T;
  label: ReactNode;
  description?: ReactNode;
  disabled?: boolean;
}

/** `className` 落在群組根元素；其餘各層用 `classNames` / `styles` / `testIds` 覆寫。 */
export type RadioGroupSlot = 'option' | 'control' | 'indicator' | 'text' | 'label' | 'description';

export interface RadioGroupProps<T extends string = string> extends SlotOverrides<RadioGroupSlot> {
  value?: T;
  defaultValue?: T;
  onValueChange?: (value: T) => void;
  options: Array<RadioOption<T>>;
  name?: string;
  disabled?: boolean;
  orientation?: RadioGroupOrientation;
  className?: string;
  'aria-label'?: string;
  'data-testid'?: string;
}

export function RadioGroup<T extends string = string>({
  value,
  defaultValue,
  onValueChange,
  options,
  name,
  disabled,
  orientation = 'vertical',
  className,
  classNames,
  styles: styleOverrides,
  testIds,
  ...rest
}: RadioGroupProps<T>) {
  const slot = createSlots({ classNames, styles: styleOverrides, testIds });
  return (
    <BaseRadioGroup
      value={value}
      defaultValue={defaultValue}
      onValueChange={(next: unknown) => onValueChange?.(next as T)}
      name={name}
      disabled={disabled}
      className={cn(styles.root, className)}
      data-orientation={orientation}
      {...rest}
    >
      {options.map((option) => (
        <label
          key={option.value}
          {...slot('option', styles.option)}
          data-disabled={option.disabled || undefined}
        >
          <BaseRadio.Root
            value={option.value}
            disabled={option.disabled}
            {...slot('control', styles.control, { testId: 'radio-option' })}
            data-value={option.value}
          >
            <BaseRadio.Indicator {...slot('indicator', styles.indicator)} />
          </BaseRadio.Root>
          <span {...slot('text', styles.text)}>
            <span {...slot('label', styles.label)}>{option.label}</span>
            {option.description && (
              <span {...slot('description', styles.description)}>{option.description}</span>
            )}
          </span>
        </label>
      ))}
    </BaseRadioGroup>
  );
}
