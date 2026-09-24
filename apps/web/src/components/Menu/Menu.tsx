import { Menu as BaseMenu } from '@base-ui-components/react/menu';
import type { ReactElement, ReactNode } from 'react';

import { cn } from '@/shared/utils';

import './Menu.css';

export interface MenuItemDescriptor {
  key: string;
  label: ReactNode;
  disabled?: boolean;
  tone?: 'default' | 'danger';
  onSelect?: () => void;
  /** 需要渲染成連結時傳入元素（例如 TanStack Router 的 Link）。 */
  render?: ReactElement<Record<string, unknown>>;
}

export interface MenuProps {
  trigger: ReactElement<Record<string, unknown>>;
  items: MenuItemDescriptor[];
  align?: 'start' | 'center' | 'end';
  className?: string;
  'data-testid'?: string;
}

export function Menu({ trigger, items, align = 'end', className, ...rest }: MenuProps) {
  return (
    <BaseMenu.Root>
      <BaseMenu.Trigger render={trigger} />
      <BaseMenu.Portal>
        <BaseMenu.Positioner align={align} sideOffset={4} className="ge-menu__positioner">
          <BaseMenu.Popup className={cn('ge-menu__popup', className)} {...rest}>
            {items.map((item) => (
              <BaseMenu.Item
                key={item.key}
                disabled={item.disabled}
                onClick={item.onSelect}
                render={item.render}
                className={cn('ge-menu__item', item.tone === 'danger' && 'ge-menu__item--danger')}
                data-testid="menu-item"
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
