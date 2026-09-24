import { createElement } from 'react';
import type { ElementType, HTMLAttributes, Ref, ReactNode } from 'react';

import { cn } from '@/shared/utils';

import './Typography.css';

export type TypographyVariant =
  | 'pageTitle'
  | 'sectionTitle'
  | 'subtitle'
  | 'body'
  | 'bodyStrong'
  | 'caption'
  | 'code';

export type TypographyTone = 'default' | 'muted' | 'brand' | 'danger' | 'success';

const VARIANT_CLASS = {
  pageTitle: 'ge-typography--pageTitle',
  sectionTitle: 'ge-typography--sectionTitle',
  subtitle: 'ge-typography--subtitle',
  body: 'ge-typography--body',
  bodyStrong: 'ge-typography--bodyStrong',
  caption: 'ge-typography--caption',
  code: 'ge-typography--code',
} as const satisfies Record<TypographyVariant, string>;

const TONE_CLASS = {
  default: 'ge-typography--default',
  muted: 'ge-typography--muted',
  brand: 'ge-typography--brand',
  danger: 'ge-typography--danger',
  success: 'ge-typography--success',
} as const satisfies Record<TypographyTone, string>;

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
      className: cn('ge-typography', VARIANT_CLASS[variant], TONE_CLASS[tone], className),
      ...rest,
    },
    children,
  );
}
