import { cn } from '@b2b-system/web-shared/utils';
import type { CSSProperties, ReactNode, Ref } from 'react';

import { createSlots } from '../slots';
import type { SlotOverrides } from '../slots';

import styles from './PageHeader.module.css';

/** `className` 落在根元素（`<header>`）；其餘各層用 `classNames` / `styles` / `testIds` 覆寫。 */
export type PageHeaderSlot = 'heading' | 'title' | 'description' | 'actions';

export interface PageHeaderProps extends SlotOverrides<PageHeaderSlot> {
  /** 透傳到根元素（React 19 的 ref 是一般 prop）。 */
  ref?: Ref<HTMLElement>;
  title: ReactNode;
  description?: ReactNode;
  /** 右側的操作（匯出、匯入、建立…）；窄螢幕時換到標題下方。 */
  actions?: ReactNode;
  /** 標題太長時截斷成一行（例：以資料命名的頁面）。 */
  truncate?: boolean;
  className?: string;
  style?: CSSProperties;
  'data-testid'?: string;
}

/**
 * 頁面的標題列：`<h1>` 標題、說明與右側的操作。操作放不下時換行到標題下方，不擠壓標題、不水平溢出。
 */
export function PageHeader({
  title,
  description,
  actions,
  truncate,
  className,
  classNames,
  styles: styleOverrides,
  testIds,
  ...rest
}: PageHeaderProps) {
  const slot = createSlots({ classNames, styles: styleOverrides, testIds });
  return (
    <header className={cn(styles.root, className)} {...rest}>
      <div {...slot('heading', styles.heading)}>
        <h1 {...slot('title', styles.title)} data-truncate={truncate || undefined}>
          {title}
        </h1>
        {description && <p {...slot('description', styles.description)}>{description}</p>}
      </div>
      {actions && <div {...slot('actions', styles.actions)}>{actions}</div>}
    </header>
  );
}
