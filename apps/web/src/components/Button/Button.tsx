import { forwardRef } from 'react';
import type { ButtonHTMLAttributes, MouseEvent, ReactNode } from 'react';

import { cn } from '@/shared/utils';

import { Spinner } from '../Spinner';

import styles from './Button.module.css';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'success' | 'warning' | 'danger';
export type ButtonSize = 'sm' | 'md' | 'lg';

export interface ButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'type'> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  block?: boolean;
  loading?: boolean;
  startIcon?: ReactNode;
  endIcon?: ReactNode;
  type?: 'button' | 'submit' | 'reset';
  /**
   * 停用時改用 `aria-disabled`，不加原生 `disabled`：按鈕仍可聚焦、收得到 hover，
   * 所以 `Tooltip` 能說明「為什麼不能按」；點擊與 Enter／Space 由元件擋下。
   * 包在 `Tooltip` 裡的停用按鈕會自動打開（與 Base UI Button 的同名選項語意相同）。
   */
  focusableWhenDisabled?: boolean;
}

/** 停用但可聚焦時擋下啟動（點擊、Enter／Space 都會觸發 click；也擋掉 submit）。 */
function preventActivation(event: MouseEvent<HTMLButtonElement>) {
  event.preventDefault();
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = 'secondary',
    size = 'md',
    block,
    loading,
    startIcon,
    endIcon,
    className,
    children,
    disabled,
    focusableWhenDisabled,
    onClick,
    type = 'button',
    ...rest
  },
  ref,
) {
  const isDisabled = Boolean(disabled || loading);
  const softDisabled = isDisabled && focusableWhenDisabled;
  return (
    <button
      ref={ref}
      type={type}
      className={cn(styles.root, className)}
      data-variant={variant}
      data-size={size}
      data-block={block || undefined}
      aria-busy={loading || undefined}
      {...rest}
      disabled={softDisabled ? undefined : isDisabled}
      aria-disabled={softDisabled || undefined}
      data-disabled={softDisabled || undefined}
      onClick={softDisabled ? preventActivation : onClick}
    >
      {loading ? <Spinner size={14} /> : startIcon}
      {children}
      {endIcon}
    </button>
  );
});
