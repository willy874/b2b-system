import { Switch as BaseSwitch } from '@base-ui-components/react/switch';

import { cn } from '@/shared/utils';

import { createSlots } from '../slots';
import type { SlotOverrides } from '../slots';

import './Switch.css';

/** `className` 落在根元素；其餘各層用 `classNames` / `styles` / `testIds` 覆寫。 */
export type SwitchSlot = 'thumb';

export interface SwitchProps extends SlotOverrides<SwitchSlot> {
  checked?: boolean;
  defaultChecked?: boolean;
  onCheckedChange?: (checked: boolean) => void;
  disabled?: boolean;
  className?: string;
  'aria-label'?: string;
  'data-testid'?: string;
}

export function Switch({ className, classNames, styles, testIds, ...rest }: SwitchProps) {
  const slot = createSlots({ classNames, styles, testIds });
  return (
    <BaseSwitch.Root className={cn('ge-switch', className)} {...rest}>
      <BaseSwitch.Thumb {...slot('thumb', 'ge-switch__thumb')} />
    </BaseSwitch.Root>
  );
}
