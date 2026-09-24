import { createElement } from 'react';
import type { ElementType, HTMLAttributes, Ref, ReactNode } from 'react';

import { cn } from '@/shared/utils';

import styles from './Typography.module.css';

export type TypographyVariant =
  | 'pageTitle'
  | 'sectionTitle'
  | 'subtitle'
  | 'body'
  | 'bodyStrong'
  | 'caption'
  | 'code';

export type TypographyTone = 'default' | 'muted' | 'brand' | 'danger' | 'success';

const DEFAULT_TAG: Record<TypographyVariant, ElementType> = {
  pageTitle: 'h1',
  sectionTitle: 'h2',
  subtitle: 'p',
  body: 'p',
  bodyStrong: 'p',
  caption: 'span',
  code: 'code',
};

export interface TypographyProps extends HTMLAttributes<HTMLElement> {
  /** 透傳到實際渲染的標籤。 */
  ref?: Ref<HTMLElement>;
  variant?: TypographyVariant;
  tone?: TypographyTone;
  /** 覆寫語意標籤（視覺與語意分離）。 */
  as?: ElementType;
  children: ReactNode;
}

export function Typography({
  variant = 'body',
  tone = 'default',
  as,
  className,
  children,
  ...rest
}: TypographyProps) {
  const tag = as ?? DEFAULT_TAG[variant];
  return createElement(
    tag,
    {
      className: cn(styles.root, className),
      'data-variant': variant,
      'data-tone': tone,
      ...rest,
    },
    children,
  );
}
