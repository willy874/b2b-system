import { forwardRef } from 'react';
import type { AnchorHTMLAttributes, ElementType, ReactElement } from 'react';

import { cn } from '@/shared/utils';

import './Link.css';

export type LinkTone = 'brand' | 'muted' | 'danger';

export type LinkUnderline = 'hover' | 'always' | 'none';

const TONE_CLASS = {
  brand: 'ge-link--brand',
  muted: 'ge-link--muted',
  danger: 'ge-link--danger',
} as const satisfies Record<LinkTone, string>;

const UNDERLINE_CLASS = {
  hover: 'ge-link--underline-hover',
  always: 'ge-link--underline-always',
  none: 'ge-link--underline-none',
} as const satisfies Record<LinkUnderline, string>;

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
  const classes = cn('ge-link', TONE_CLASS[tone], UNDERLINE_CLASS[underline], className);

  if (render) {
    const Rendered = render.type as ElementType;
    return (
      <Rendered
        {...render.props}
        {...rest}
        ref={ref}
        className={cn(classes, render.props.className)}
      >
        {children ?? (render.props as { children?: unknown }).children}
      </Rendered>
    );
  }

  return (
    <a ref={ref} className={classes} {...rest}>
      {children}
    </a>
  );
});
