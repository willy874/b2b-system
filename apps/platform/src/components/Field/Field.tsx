import { Field as BaseField } from '@base-ui/react/field';
import type { ReactNode, Ref } from 'react';

import { cn } from '@/shared/utils';

import { useComponentLabels } from '../labels';
import { createSlots } from '../slots';
import type { SlotOverrides } from '../slots';

import styles from './Field.module.css';

/** `className` 落在根元素；其餘各層用 `classNames` / `styles` / `testIds` 覆寫。 */
export type FieldSlot = 'label' | 'required' | 'description' | 'error';

export interface FieldProps extends SlotOverrides<FieldSlot> {
  /** 透傳到根元素（React 19 的 ref 是一般 prop）。 */
  ref?: Ref<HTMLDivElement>;
  /** 對應 `Form` 的 `errors` 鍵（後端回傳的欄位錯誤靠這個對上）。 */
  name?: string;
  label?: ReactNode;
  description?: ReactNode;
  /** 有值即視為錯誤狀態，訊息以 aria-describedby 連到輸入元素。 */
  error?: string;
  required?: boolean;
  className?: string;
  children: ReactNode;
  'data-testid'?: string;
}

export function Field({
  name,
  label,
  description,
  error,
  required,
  className,
  children,
  classNames,
  styles: styleOverrides,
  testIds,
  ...rest
}: FieldProps) {
  const slot = createSlots({ classNames, styles: styleOverrides, testIds });
  const labels = useComponentLabels();
  return (
    <BaseField.Root
      name={name}
      className={cn(styles.root, className)}
      invalid={error ? true : undefined}
      validationMode="onSubmit"
      {...rest}
    >
      {label && (
        <BaseField.Label {...slot('label', styles.label)}>
          {label}
          {required && (
            <>
              <span {...slot('required', styles.required)} aria-hidden="true">
                *
              </span>{' '}
              {/*
                星號對報讀器沒有意義：另外念出「必填」。分隔的空白放在 span 外面：accname 的實作
                （dom-accessibility-api）會修剪每個元素自己的文字，span 裡的前導空白會被吃掉
              */}
              <span className={styles.srOnly}>{labels.required}</span>
            </>
          )}
        </BaseField.Label>
      )}
      {children}
      {description && !error && (
        <BaseField.Description {...slot('description', styles.description)}>
          {description}
        </BaseField.Description>
      )}
      {/* 明確傳入的錯誤（例如 TanStack Form 的欄位驗證） */}
      {error && (
        <BaseField.Error match {...slot('error', styles.error)}>
          {error}
        </BaseField.Error>
      )}
      {/* 沒有明確錯誤時，顯示 Form 從後端帶進來的欄位錯誤 */}
      {!error && <BaseField.Error {...slot('error', styles.error)} />}
    </BaseField.Root>
  );
}

export const FieldPrimitive = BaseField;
