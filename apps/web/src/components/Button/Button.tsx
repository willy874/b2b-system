import { forwardRef } from 'react';
import type { ButtonHTMLAttributes, ReactNode } from 'react';

import { cn } from '@/shared/utils';

import { Spinner } from '../Spinner';

import './Button.css';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md' | 'lg';

const VARIANT_CLASS = {
  primary: 'ge-button--primary',
  secondary: 'ge-button--secondary',
  ghost: 'ge-button--ghost',
  danger: 'ge-button--danger',
} as const satisfies Record<ButtonVariant, string>;

/** `md` 是預設尺寸，不加 modifier。 */
const SIZE_CLASS = {
  sm: 'ge-button--sm',
  md: undefined,
  lg: 'ge-button--lg',
} as const satisfies Record<ButtonSize, string | undefined>;

export interface ButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'type'> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  block?: boolean;
  loading?: boolean;
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
    <button
      ref={ref}
      type={type}
      className={cn(
        'ge-button',
        VARIANT_CLASS[variant],
        SIZE_CLASS[size],
        block && 'ge-button--block',
        className,
      )}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...rest}
    >
      {loading ? <Spinner size={14} /> : startIcon}
      {children}
      {endIcon}
    </button>
  );
});
