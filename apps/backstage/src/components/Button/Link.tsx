import { createLink } from '@tanstack/react-router';
import { forwardRef } from 'react';
import type { AnchorHTMLAttributes, ReactNode } from 'react';

import { cn } from '@/shared/utils';

import type { ButtonSize, ButtonVariant } from './Button';

import styles from './Button.module.css';

export interface ButtonAnchorProps extends AnchorHTMLAttributes<HTMLAnchorElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  block?: boolean;
  startIcon?: ReactNode;
  endIcon?: ReactNode;
  /** TanStack Router 在 `disabled` 時會拿掉 `href` 並擋下點擊；這裡只負責外觀與 ARIA。 */
  disabled?: boolean;
}

/** 長得像 `Button` 的 `<a>`；與 `Button` 共用同一份樣式與 data-* 變體。 */
const ButtonAnchor = forwardRef<HTMLAnchorElement, ButtonAnchorProps>(function ButtonAnchor(
  {
    variant = 'secondary',
    size = 'md',
    block,
    startIcon,
    endIcon,
    disabled,
    className,
    children,
    ...rest
  },
  ref,
) {
  return (
    <a
      ref={ref}
      className={cn(styles.root, className)}
      data-variant={variant}
      data-size={size}
      data-block={block || undefined}
      data-disabled={disabled || undefined}
      aria-disabled={disabled || undefined}
      {...rest}
    >
      {startIcon}
      {children}
      {endIcon}
    </a>
  );
});

/**
 * 按鈕外觀的導頁連結：用在「點了就換頁」的動作（建立、管理權限…），
 * 取代 `<Button onClick={() => navigate(...)}>`——使用者才能中鍵開新分頁、看到目的網址，
 * 路由也能預先載入。props 是 TanStack `Link` 的 `to` / `params` / `search` ＋ `Button` 的外觀。
 *
 * 文字連結用 `components/Link`；站外連結直接用 `components/Link` 的 `href`。
 */
export const ButtonLink = createLink(ButtonAnchor);
