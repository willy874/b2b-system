import { cn } from '@b2b-system/web-shared/utils';
import { forwardRef } from 'react';

import { Button } from './Button';
import type { ButtonProps } from './Button';

import styles from './Button.module.css';

export interface IconButtonProps extends Omit<ButtonProps, 'startIcon' | 'endIcon' | 'block'> {
  /** 圖示按鈕沒有文字，必須提供無障礙名稱。 */
  'aria-label': string;
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { className, variant = 'ghost', ...rest },
  ref,
) {
  return <Button ref={ref} variant={variant} className={cn(styles.icon, className)} {...rest} />;
});
