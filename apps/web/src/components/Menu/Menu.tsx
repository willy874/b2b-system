import { Menu as BaseMenu } from '@base-ui-components/react/menu';
import type { ReactElement, ReactNode } from 'react';

import { cn } from '@/shared/utils';

import { createSlots } from '../slots';
import type { SlotOverrides } from '../slots';

import styles from './Menu.module.css';

export interface MenuItemDescriptor {
  key: string;
  label: ReactNode;
  disabled?: boolean;
  tone?: 'default' | 'danger';
  onSelect?: () => void;
  /** 需要渲染成連結時傳入元素（例如 TanStack Router 的 Link）。 */
  render?: ReactElement<Record<string, unknown>>;
}

/** `className` 落在選單（popup）；其餘各層用 `classNames` / `styles` / `testIds` 覆寫。 */
export type MenuSlot = 'positioner' | 'item';

export interface MenuProps extends SlotOverrides<MenuSlot> {
  trigger: ReactElement<Record<string, unknown>>;
  items: MenuItemDescriptor[];
  align?: 'start' | 'center' | 'end';
  className?: string;
  'data-testid'?: string;
}

export function Menu({
  trigger,
  items,
  align = 'end',
  className,
  classNames,
  styles: styleOverrides,
  testIds,
  ...rest
}: MenuProps) {
  const slot = createSlots({ classNames, styles: styleOverrides, testIds });
  return (
    <BaseMenu.Root>
      <BaseMenu.Trigger render={trigger} />
      <BaseMenu.Portal>
        <BaseMenu.Positioner
          align={align}
          sideOffset={4}
          {...slot('positioner', styles.positioner)}
        >
          <BaseMenu.Popup className={cn(styles.popup, className)} {...rest}>
            {items.map((item) => (
              <BaseMenu.Item
                key={item.key}
                disabled={item.disabled}
                onClick={item.onSelect}
                render={item.render}
                {...slot('item', styles.item, { testId: 'menu-item' })}
                data-tone={item.tone ?? 'default'}
                data-value={item.key}
              >
                {item.label}
              </BaseMenu.Item>
            ))}
          </BaseMenu.Popup>
        </BaseMenu.Positioner>
      </BaseMenu.Portal>
    </BaseMenu.Root>
  );
}
