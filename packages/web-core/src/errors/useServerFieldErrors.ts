import { useCallback, useEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';

import { useTranslation } from '../locales';
import { AppError } from './AppError';
import type { KnownErrorCode } from './errorMessageKey';
import { useErrorMessage } from './useErrorMessage';

export interface ServerFieldErrors<TField extends string> {
  /** 每個欄位目前的後端錯誤（沒有就是 undefined）。 */
  errors: Partial<Record<TField, string>>;
  /**
   * 送出失敗時呼叫：能對應到欄位的錯誤（`VALIDATION_FAILED` 的 `details.fields`、`conflicts` 登記的衝突碼）
   * 放到欄位下方並聚焦第一個錯誤欄位，回傳 `true`；對應不到的回傳 `false`，由呼叫端顯示在表單層級。
   */
  report: (error: unknown) => boolean;
  /** 使用者改了某個欄位就清掉它的後端錯誤。 */
  clear: (field: TField) => void;
  reset: () => void;
  /** 掛在 `<form>` 上：聚焦第一個錯誤欄位時在這個範圍內找。 */
  formRef: RefObject<HTMLFormElement | null>;
}

/**
 * 後端錯誤回填到欄位。
 * `details.fields` 的內容是後端 Zod 的英文訊息，不直接顯示，改用本地化的「格式不正確」。
 */
export function useServerFieldErrors<TField extends string>(
  fields: readonly TField[],
  conflicts: Partial<Record<KnownErrorCode, TField>> = {},
): ServerFieldErrors<TField> {
  const { t } = useTranslation();
  const toMessage = useErrorMessage();
  const [errors, setErrors] = useState<Partial<Record<TField, string>>>({});
  const [focusRequest, setFocusRequest] = useState(0);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (focusRequest === 0) return;
    formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
  }, [focusRequest]);

  const report = useCallback(
    (error: unknown) => {
      if (!(error instanceof AppError)) return false;
      const next: Partial<Record<TField, string>> = {};
      const conflictField = conflicts[error.code as KnownErrorCode];
      if (conflictField) next[conflictField] = toMessage(error);
      for (const key of Object.keys(error.fieldErrors ?? {})) {
        if ((fields as readonly string[]).includes(key))
          next[key as TField] = t('validation.invalid');
      }
      if (Object.keys(next).length === 0) return false;
      setErrors(next);
      setFocusRequest((count) => count + 1);
      return true;
    },
    [conflicts, fields, t, toMessage],
  );

  const clear = useCallback((field: TField) => {
    setErrors((previous) => {
      if (!previous[field]) return previous;
      const next = { ...previous };
      delete next[field];
      return next;
    });
  }, []);

  const reset = useCallback(() => setErrors({}), []);

  return { errors, report, clear, reset, formRef };
}
