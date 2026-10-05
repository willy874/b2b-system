import { cn } from '@b2b-system/web-shared/utils';
import { createElement } from 'react';
import type { ElementType, HTMLAttributes, Ref, ReactNode } from 'react';

import { createSlots } from '../slots';
import type { SlotOverrides } from '../slots';
import { CopyButton } from './CopyButton';
import type { TypographyCopyable } from './useCopyable';

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

/** `className` / `data-testid` 落在文字本身（根元素）；`copy` 是 `copyable` 的複製按鈕。 */
export type TypographySlot = 'copy';

const DEFAULT_TAG: Record<TypographyVariant, ElementType> = {
  pageTitle: 'h1',
  sectionTitle: 'h2',
  subtitle: 'p',
  body: 'p',
  bodyStrong: 'p',
  caption: 'span',
  code: 'code',
};

export interface TypographyProps
  extends HTMLAttributes<HTMLElement>, SlotOverrides<TypographySlot> {
  /** 透傳到實際渲染的標籤。 */
  ref?: Ref<HTMLElement>;
  variant?: TypographyVariant;
  tone?: TypographyTone;
  /** 加粗；與 `variant` 無關，任何變體都能疊加。 */
  strong?: boolean;
  /** 在文字後面加一個複製按鈕；給物件可指定複製內容、文案與回呼。 */
  copyable?: TypographyCopyable;
  /** 覆寫語意標籤（視覺與語意分離）。 */
  as?: ElementType;
  children: ReactNode;
}

/**
 * 文字的底層元件。日常使用優先選語意更明確的 `Title` / `Text` / `Paragraph`，
 * 需要直接指定 `variant` 時才用這個。
 */
export function Typography({
  variant = 'body',
  tone = 'default',
  strong,
  copyable,
  as,
  className,
  classNames,
  styles: styleOverrides,
  testIds,
  children,
  ...rest
}: TypographyProps) {
  const tag = as ?? DEFAULT_TAG[variant];
  const slot = createSlots({ classNames, styles: styleOverrides, testIds });
  return createElement(
    tag,
    {
      className: cn(styles.root, className),
      'data-variant': variant,
      'data-tone': tone,
      'data-strong': strong || undefined,
      ...rest,
    },
    children,
    copyable ? (
      <CopyButton
        config={copyable === true ? {} : copyable}
        source={children}
        slotAttributes={slot('copy', styles.copy, { testId: 'typography-copy' })}
      />
    ) : null,
  );
}
