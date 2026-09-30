import { z } from 'zod';

type Translate = (key: string, options?: Record<string, unknown>) => string;

/**
 * 自訂驗證（`.refine()`）的訊息：`params.messageKey` 帶完整的語系鍵，
 * 不寫死英文 `message`（docs/conventions/06-literal-strings.md §3.1）。
 *
 * ```ts
 * .refine((v) => v.password === v.confirmPassword, {
 *   path: ['confirmPassword'],
 *   params: { messageKey: 'validation.passwordMismatch' },
 * })
 * ```
 */
export interface ValidationParams {
  messageKey: string;
}

function isValidationParams(params: unknown): params is ValidationParams {
  return (
    typeof params === 'object' &&
    params !== null &&
    typeof (params as { messageKey?: unknown }).messageKey === 'string'
  );
}

/**
 * Zod 的 issue → 使用者看得懂的語系訊息（UX-10）。Zod 預設是 `Too small: expected string to have >=1 characters`
 * 這種技術字串，而且是英文。翻譯在驗證當下才做，所以切換語系後下一次驗證就是新語言。
 */
export function createZodErrorMap(translate: Translate): z.core.$ZodErrorMap {
  return (issue) => {
    switch (issue.code) {
      case 'invalid_type':
        return translate(issue.input === undefined ? 'validation.required' : 'validation.invalid');
      case 'too_small':
        if (issue.origin === 'string') {
          return Number(issue.minimum) <= 1
            ? translate('validation.required')
            : translate('validation.tooShort', { min: Number(issue.minimum) });
        }
        return translate('validation.invalid');
      case 'too_big':
        return issue.origin === 'string'
          ? translate('validation.tooLong', { max: Number(issue.maximum) })
          : translate('validation.invalid');
      case 'invalid_format':
        return translate(issue.format === 'email' ? 'validation.email' : 'validation.format');
      case 'custom':
        return isValidationParams(issue.params)
          ? translate(issue.params.messageKey)
          : translate('validation.invalid');
      default:
        return translate('validation.invalid');
    }
  };
}

/** 讓全域的 Zod 驗證訊息走語系（i18n plugin 初始化時呼叫一次）。 */
export function configureZodErrorMap(translate: Translate): void {
  z.config({ customError: createZodErrorMap(translate) });
}
