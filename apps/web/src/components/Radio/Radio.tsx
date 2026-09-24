import { Radio as BaseRadio } from '@base-ui-components/react/radio';
import { RadioGroup as BaseRadioGroup } from '@base-ui-components/react/radio-group';
import type { ReactNode } from 'react';

import { cn } from '@/shared/utils';

import { createSlots } from '../slots';
import type { SlotOverrides } from '../slots';

import './Radio.css';

export type RadioGroupOrientation = 'vertical' | 'horizontal';

const ORIENTATION_CLASS = {
  vertical: 'ge-radio-group--vertical',
  horizontal: 'ge-radio-group--horizontal',
} as const satisfies Record<RadioGroupOrientation, string>;

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
  styles,
  testIds,
  ...rest
}: RadioGroupProps<T>) {
  const slot = createSlots({ classNames, styles, testIds });
  return (
    <BaseRadioGroup
      value={value}
      defaultValue={defaultValue}
      onValueChange={(next: unknown) => onValueChange?.(next as T)}
      name={name}
      disabled={disabled}
      className={cn('ge-radio-group', ORIENTATION_CLASS[orientation], className)}
      {...rest}
    >
      {options.map((option) => (
        <label
          key={option.value}
          {...slot('option', ['ge-radio', option.disabled && 'ge-radio--disabled'])}
        >
          <BaseRadio.Root
            value={option.value}
            disabled={option.disabled}
            {...slot('control', 'ge-radio__control', { testId: 'radio-option' })}
            data-value={option.value}
          >
            <BaseRadio.Indicator {...slot('indicator', 'ge-radio__indicator')} />
          </BaseRadio.Root>
          <span {...slot('text', 'ge-radio__text')}>
            <span {...slot('label', 'ge-radio__label')}>{option.label}</span>
            {option.description && (
              <span {...slot('description', 'ge-radio__description')}>{option.description}</span>
            )}
          </span>
        </label>
      ))}
    </BaseRadioGroup>
  );
}
