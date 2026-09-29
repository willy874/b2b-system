import type { ZodType } from 'zod';

export interface FormFieldErrors {
  fields: Record<string, string>;
}

/**
 * TanStack Form 的 validator：Zod 失敗時回 `{ fields }`，
 * 形狀與後端 `VALIDATION_FAILED` 的 `details.fields` 一致。
 */
export function zodFormValidator<TValue>(schema: ZodType<unknown>) {
  return ({ value }: { value: TValue }): FormFieldErrors | undefined => {
    const result = schema.safeParse(value);
    if (result.success) return undefined;
    const fields: Record<string, string> = {};
    for (const issue of result.error.issues) {
      const path = issue.path.join('.') || '_';
      fields[path] ??= issue.message;
    }
    return { fields };
  };
}

/** 欄位錯誤可能是字串或 `{ message }`，統一取出可顯示的訊息。 */
export function firstError(errors: readonly unknown[]): string | undefined {
  const error = errors[0];
  if (!error) return undefined;
  if (typeof error === 'string') return error;
  if (typeof error === 'object' && 'message' in error) {
    return String((error as { message: unknown }).message);
  }
  return String(error);
}
