import { forwardRef } from 'react';
import type { AnchorHTMLAttributes, ElementType, ReactElement } from 'react';

import { cn } from '@/shared/utils';

import styles from './Link.module.css';

export type LinkTone = 'brand' | 'muted' | 'danger';

export type LinkUnderline = 'hover' | 'always' | 'none';

export interface LinkProps extends AnchorHTMLAttributes<HTMLAnchorElement> {
  tone?: LinkTone;
  /** 以其他元素渲染（例如 TanStack Router 的 `Link`），保留樣式與行為。 */
  render?: ReactElement<{ className?: string }>;
  underline?: LinkUnderline;
}

/**
 * 只負責「連結的樣子」。要導頁時把 router 的 Link 用 `render` 傳進來，
 * 這一層不認識任何路由函式庫。
 */
export const Link = forwardRef<HTMLAnchorElement, LinkProps>(function Link(
  { tone = 'brand', underline = 'hover', render, className, children, ...rest },
  ref,
) {
  const classes = cn(styles.root, className);

  if (render) {
    const Rendered = render.type as ElementType;
    return (
      <Rendered
        {...render.props}
        data-tone={tone}
        data-underline={underline}
        {...rest}
        ref={ref}
        className={cn(classes, render.props.className)}
      >
        {children ?? (render.props as { children?: unknown }).children}
      </Rendered>
    );
  }

  return (
    <a ref={ref} className={classes} data-tone={tone} data-underline={underline} {...rest}>
      {children}
    </a>
  );
});
