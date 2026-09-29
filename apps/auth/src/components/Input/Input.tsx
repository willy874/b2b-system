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
      aria-invalid={invalid || undefined}
      {...rest}
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
