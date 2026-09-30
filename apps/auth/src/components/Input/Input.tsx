import { Input as BaseInput } from '@base-ui-components/react/input';
import { forwardRef } from 'react';
import type { InputHTMLAttributes, TextareaHTMLAttributes } from 'react';

import { cn } from '@/shared/utils';

import styles from './Input.module.css';

export interface InputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'size'> {
  size?: 'sm' | 'md';
  invalid?: boolean;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { className, size = 'md', invalid, ...rest },
  ref,
) {
  return (
    <BaseInput
      ref={ref}
      className={cn(styles.root, className)}
      data-size={size}
      {...rest}
      // Field 帶進來的錯誤（`<Field error>`）只會讓 Base UI 標上 data-invalid；
      // 報讀器看的是 aria-invalid，所以依 Field 的狀態補上
      render={(props, state) => (
        <input
          {...props}
          aria-invalid={props['aria-invalid'] ?? (invalid || state.valid === false || undefined)}
        />
      )}
    />
  );
});

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  invalid?: boolean;
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  { className, invalid, rows = 3, ...rest },
  ref,
) {
  return (
    <textarea
      ref={ref}
      rows={rows}
      className={cn(styles.root, styles.textarea, className)}
      aria-invalid={invalid || undefined}
      {...rest}
    />
  );
});
