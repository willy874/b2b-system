import { cn } from '@b2b-system/web-shared/utils';
import { Field as BaseField } from '@base-ui/react/field';
import { useId, useMemo } from 'react';
import type { ReactNode, Ref } from 'react';

import { useComponentLabels } from '../labels';
import { createSlots } from '../slots';
import type { SlotOverrides } from '../slots';
import { FieldControlContext } from './fieldControl';
import type { FieldControlContextValue } from './fieldControl';

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
  /**
   * 錯誤的代碼（例：後端的錯誤碼），放在錯誤訊息的 `data-value`：測試以它分辨是哪一種錯誤，不比對會隨語系變的文字。
   * 錯誤訊息的 `data-testid` 預設 `field-error`（可由 `testIds.error` 覆寫）。
   */
  errorCode?: string;
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
  errorCode,
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
  // 自製控制項（Select、DatePicker）登記不到 Base UI 的 Field，改由 FieldControlContext 交給它們 id
  const baseId = useId();
  const labelId = label ? `${baseId}-label` : undefined;
  const descriptionId = description && !error ? `${baseId}-description` : undefined;
  const errorId = error ? `${baseId}-error` : undefined;
  const controlId = `${baseId}-control`;
  const control = useMemo<FieldControlContextValue>(
    () => ({
      controlId,
      labelId,
      describedBy: [descriptionId, errorId].filter(Boolean).join(' ') || undefined,
      invalid: Boolean(error),
    }),
    [controlId, labelId, descriptionId, errorId, error],
  );
  return (
    <BaseField.Root
      name={name}
      className={cn(styles.root, className)}
      invalid={error ? true : undefined}
      validationMode="onSubmit"
      {...rest}
    >
      {label && (
        <BaseField.Label
          {...slot('label', styles.label)}
          id={labelId}
          // Base UI 的 <label for> 只指得到向它登記的控制項；自製控制項（帶 controlId）由這裡聚焦
          onClick={(event) => event.currentTarget.ownerDocument.getElementById(controlId)?.focus()}
        >
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
      <FieldControlContext value={control}>{children}</FieldControlContext>
      {description && !error && (
        <BaseField.Description {...slot('description', styles.description)} id={descriptionId}>
          {description}
        </BaseField.Description>
      )}
      {/* 明確傳入的錯誤（例如 TanStack Form 的欄位驗證） */}
      {error && (
        <BaseField.Error
          match
          {...slot('error', styles.error, { testId: 'field-error' })}
          id={errorId}
          data-value={errorCode}
        >
          {error}
        </BaseField.Error>
      )}
      {/* 沒有明確錯誤時，顯示 Form 從後端帶進來的欄位錯誤 */}
      {!error && <BaseField.Error {...slot('error', styles.error, { testId: 'field-error' })} />}
    </BaseField.Root>
  );
}

export const FieldPrimitive = BaseField;
