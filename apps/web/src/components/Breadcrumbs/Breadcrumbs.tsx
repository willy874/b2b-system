import { Fragment } from 'react';
import type { ReactElement, ReactNode, Ref } from 'react';

import { cn } from '@/shared/utils';

import { Icon } from '../Icon';
import { Link } from '../Link';

import './Breadcrumbs.css';

export interface BreadcrumbItem {
  key: string;
  label: ReactNode;
  href?: string;
  /** 以其他元素渲染（例如 router 的 Link）。 */
  render?: ReactElement<Record<string, unknown>>;
}

export interface BreadcrumbsProps {
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
  ...rest
}: BreadcrumbsProps) {
  return (
    <nav aria-label={ariaLabel} className={cn('ge-breadcrumbs', className)} {...rest}>
      <ol className="ge-breadcrumbs__list">
        {items.map((item, index) => {
          const isLast = index === items.length - 1;
          return (
            <Fragment key={item.key}>
              <li className="ge-breadcrumbs__item">
                {isLast ? (
                  <span className="ge-breadcrumbs__current" aria-current="page">
                    {item.label}
                  </span>
                ) : (
                  <Link href={item.href} render={item.render} tone="muted">
                    {item.label}
                  </Link>
                )}
              </li>
              {!isLast && (
                <li aria-hidden="true" className="ge-breadcrumbs__separator">
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
