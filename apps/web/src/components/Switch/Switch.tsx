import { Switch as BaseSwitch } from '@base-ui-components/react/switch';

import { cn } from '@/shared/utils';

import './Switch.css';

export interface SwitchProps {
  checked?: boolean;
  defaultChecked?: boolean;
  onCheckedChange?: (checked: boolean) => void;
  disabled?: boolean;
  className?: string;
  'aria-label'?: string;
  'data-testid'?: string;
}

export function Switch({ className, ...rest }: SwitchProps) {
  return (
    <BaseSwitch.Root className={cn('ge-switch', className)} {...rest}>
      <BaseSwitch.Thumb className="ge-switch__thumb" />
    </BaseSwitch.Root>
  );
}
