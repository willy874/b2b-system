import { cn } from '@b2b-system/web-shared/utils';
import { Switch as BaseSwitch } from '@base-ui/react/switch';

import { createSlots } from '../slots';
import type { SlotOverrides } from '../slots';

import styles from './Switch.module.css';

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

export function Switch({
  className,
  classNames,
  styles: styleOverrides,
  testIds,
  ...rest
}: SwitchProps) {
  const slot = createSlots({ classNames, styles: styleOverrides, testIds });
  return (
    <BaseSwitch.Root className={cn(styles.root, className)} {...rest}>
      <BaseSwitch.Thumb {...slot('thumb', styles.thumb)} />
    </BaseSwitch.Root>
  );
}
