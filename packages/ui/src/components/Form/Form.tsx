import { cn } from '@b2b-system/web-shared/utils';
import { Form as BaseForm } from '@base-ui/react/form';
import type { FormHTMLAttributes, ReactNode } from 'react';

import styles from './Form.module.css';

export interface FormProps extends FormHTMLAttributes<HTMLFormElement> {
  /**
   * 伺服器回傳的欄位錯誤（後端 `VALIDATION_FAILED` 的 `details.fields`）。
   * 鍵要對上 `Field` 的 `name`，錯誤會顯示在該欄位下方。
   */
  errors?: Record<string, string | string[]>;
  children: ReactNode;
}

/** 把後端的欄位錯誤接到表單上的薄封裝；驗證本身由 TanStack Form ＋ Zod 負責。 */
export function Form({ errors, className, children, ...rest }: FormProps) {
  return (
    <BaseForm errors={errors} className={cn(styles.root, className)} {...rest}>
      {children}
    </BaseForm>
  );
}
