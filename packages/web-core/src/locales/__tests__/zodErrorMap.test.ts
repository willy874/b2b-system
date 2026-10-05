import { zodFormValidator } from '@b2b-system/web-shared/hooks';
import i18next from 'i18next';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import enUS from '../resources/en_US.json';
import zhTW from '../resources/zh_TW.json';
import { configureZodErrorMap, createZodErrorMap } from '../zodErrorMap';

/** 把語系鍵與參數原樣吐回來，方便斷言對應到哪個鍵。 */
const echo = (key: string, options?: Record<string, unknown>) =>
  options ? `${key} ${JSON.stringify(options)}` : key;
const errorMap = createZodErrorMap(echo);

function messageOf(schema: z.ZodType, value: unknown): string | undefined {
  const result = schema.safeParse(value, { error: errorMap });
  return result.success ? undefined : result.error.issues[0]?.message;
}

describe('createZodErrorMap（表單驗證訊息走語系）', () => {
  it.each([
    ['空字串（min(1)）', z.string().min(1), '', 'validation.required'],
    ['沒有值', z.string(), undefined, 'validation.required'],
    ['型別錯誤', z.string(), 42, 'validation.invalid'],
    ['email 格式', z.string().email(), 'not-an-email', 'validation.email'],
    ['其他格式', z.string().regex(/^a/), 'b', 'validation.format'],
    ['太短', z.string().min(12), 'short', 'validation.tooShort {"min":12}'],
    ['太長', z.string().max(3), 'toolong', 'validation.tooLong {"max":3}'],
    ['數字範圍', z.number().min(5), 1, 'validation.invalid'],
  ])('%s → %s', (_label, schema, value, expected) => {
    expect(messageOf(schema, value)).toBe(expected);
  });

  it('refine 以 params.messageKey 指定語系鍵', () => {
    const schema = z
      .object({ password: z.string(), confirmPassword: z.string() })
      .refine((value) => value.password === value.confirmPassword, {
        path: ['confirmPassword'],
        params: { messageKey: 'validation.passwordMismatch' },
      });
    expect(messageOf(schema, { password: 'a', confirmPassword: 'b' })).toBe(
      'validation.passwordMismatch',
    );
  });

  it('refine 沒有 messageKey → 通用訊息', () => {
    expect(
      messageOf(
        z.string().refine(() => false),
        'x',
      ),
    ).toBe('validation.invalid');
  });

  it('全域設定後，表單的欄位錯誤是目前語系的文字，切換語系跟著變', async () => {
    const i18n = i18next.createInstance();
    await i18n.init({
      lng: 'zh_TW',
      resources: { zh_TW: { translation: zhTW }, en_US: { translation: enUS } },
      interpolation: { escapeValue: false },
    });
    configureZodErrorMap((key, options) => i18n.t(key, options ?? {}));
    const validate = zodFormValidator<{ email: string }>(
      z.object({ email: z.string().trim().min(1).email() }),
    );

    expect(validate({ value: { email: '' } })?.fields.email).toBe('請填寫這個欄位');
    expect(validate({ value: { email: 'x' } })?.fields.email).toBe('請輸入有效的 Email');

    await i18n.changeLanguage('en_US');
    expect(validate({ value: { email: 'x' } })?.fields.email).toBe('Enter a valid email address');
    // 不再出現 Zod 的技術字串
    expect(validate({ value: { email: '' } })?.fields.email).not.toContain('>=');
  });
});
