import { Radio as BaseRadio } from '@base-ui-components/react/radio';
import { RadioGroup as BaseRadioGroup } from '@base-ui-components/react/radio-group';
import type { ReactNode } from 'react';

import { cn } from '@/shared/utils';

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

export interface RadioGroupProps<T extends string = string> {
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
  ...rest
}: RadioGroupProps<T>) {
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
          className={cn('ge-radio', option.disabled && 'ge-radio--disabled')}
        >
          <BaseRadio.Root
            value={option.value}
            disabled={option.disabled}
            className="ge-radio__control"
            data-testid="radio-option"
            data-value={option.value}
          >
            <BaseRadio.Indicator className="ge-radio__indicator" />
          </BaseRadio.Root>
          <span className="ge-radio__text">
            <span className="ge-radio__label">{option.label}</span>
            {option.description && (
              <span className="ge-radio__description">{option.description}</span>
            )}
          </span>
        </label>
      ))}
    </BaseRadioGroup>
  );
}
