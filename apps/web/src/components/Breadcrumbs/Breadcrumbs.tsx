import { Fragment } from 'react';
import type { ReactElement, ReactNode, Ref } from 'react';

import { Icon } from '../Icon';
import { Link } from '../Link';
import { createSlots } from '../slots';
import type { SlotOverrides } from '../slots';

import styles from './Breadcrumbs.module.css';

export interface BreadcrumbItem {
  key: string;
  label: ReactNode;
  href?: string;
  /** 以其他元素渲染（例如 router 的 Link）。 */
  render?: ReactElement<Record<string, unknown>>;
}

/** `className` 落在根元素（`<nav>`）；其餘各層用 `classNames` / `styles` / `testIds` 覆寫。 */
export type BreadcrumbsSlot = 'list' | 'item' | 'link' | 'current' | 'separator';

export interface BreadcrumbsProps extends SlotOverrides<BreadcrumbsSlot> {
  items: BreadcrumbItem[];
  /** 透傳到根元素（React 19 的 ref 是一般 prop）。 */
  ref?: Ref<HTMLElement>;
  className?: string;
  'aria-label'?: string;
  'data-testid'?: string;
}

/** 最後一項是當前頁面：不是連結，並標記 `aria-current="page"`。 */
export function Breadcrumbs({
  items,
  className,
  'aria-label': ariaLabel = 'breadcrumb',
  classNames,
  styles: styleOverrides,
  testIds,
  ...rest
}: BreadcrumbsProps) {
  const slot = createSlots({ classNames, styles: styleOverrides, testIds });
  return (
    <nav aria-label={ariaLabel} className={className} {...rest}>
      <ol {...slot('list', styles.list)}>
        {items.map((item, index) => {
          const isLast = index === items.length - 1;
          return (
            <Fragment key={item.key}>
              <li {...slot('item', styles.item)} data-value={item.key}>
                {isLast ? (
                  <span {...slot('current', styles.current)} aria-current="page">
                    {item.label}
                  </span>
                ) : (
                  <Link href={item.href} render={item.render} tone="muted" {...slot('link')}>
                    {item.label}
                  </Link>
                )}
              </li>
              {!isLast && (
                <li aria-hidden="true" {...slot('separator', styles.separator)}>
                  <Icon name="chevron-right" size={16} />
                </li>
              )}
            </Fragment>
          );
        })}
      </ol>
    </nav>
  );
}
