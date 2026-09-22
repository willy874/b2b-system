import { Button as BaseButton } from '@base-ui-components/react/button';
import { forwardRef } from 'react';
import type { ButtonHTMLAttributes, ReactNode, Ref } from 'react';

import { cn } from '@/shared/utils';

import { Spinner } from '../Spinner';

import './Button.css';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md' | 'lg';

export interface ButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'type'> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  block?: boolean;
  loading?: boolean;
  /**
   * 停用時仍保留焦點（改用 `aria-disabled`）。
   * 停用的理由需要被說明時（例如外面包了解釋原因的 `Tooltip`）必須開，
   * 否則鍵盤使用者永遠聚焦不到，也就永遠讀不到那個理由。`loading` 一律隱含開啟。
   */
  focusableWhenDisabled?: boolean;
  startIcon?: ReactNode;
  endIcon?: ReactNode;
  type?: 'button' | 'submit' | 'reset';
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = 'secondary',
    size = 'md',
    block,
    loading,
    focusableWhenDisabled,
    startIcon,
    endIcon,
    className,
    children,
    disabled,
    type = 'button',
    ...rest
  },
  ref,
) {
  return (
    <BaseButton
      ref={ref as Ref<HTMLElement>}
      type={type}
      className={cn(
        'ge-button',
        `ge-button--${variant}`,
        size !== 'md' && `ge-button--${size}`,
        block && 'ge-button--block',
        className,
      )}
      disabled={disabled || loading}
      /*
       * loading 時一定要能被聚焦：按下送出後元素若整個離開 tab order，
       * 瀏覽器會把焦點踢回 <body>，鍵盤使用者失去位置、`aria-busy` 也念不到。
       * Base UI 在這個模式下改用 `aria-disabled` + `data-disabled`，
       * 樣式與點擊阻擋都還在（見 Button.css 的 [data-disabled]）。
       */
      focusableWhenDisabled={focusableWhenDisabled || loading}
      aria-busy={loading || undefined}
      {...rest}
    >
      {loading ? <Spinner size={14} /> : startIcon}
      {children}
      {endIcon}
    </BaseButton>
  );
});
