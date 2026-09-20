import type { ReactNode, Ref } from 'react';

import { cn } from '@/shared/utils';

import './Empty.css';

export interface EmptyProps {
  /** 透傳到根元素（React 19 的 ref 是一般 prop）。 */
  ref?: Ref<HTMLDivElement>;
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
  'data-testid'?: string;
}

export function Empty({ title, description, action, className, ...rest }: EmptyProps) {
  return (
    <div className={cn('ge-empty', className)} {...rest}>
      <p className="ge-empty__title">{title}</p>
      {description && <p className="ge-empty__description">{description}</p>}
      {action && <div className="ge-empty__action">{action}</div>}
    </div>
  );
}
