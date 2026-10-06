import { act, renderHook } from '@testing-library/react';
import { beforeAll, describe, expect, it } from 'vitest';

import { i18n, initI18n } from '../../locales';
import zhTW from '../../locales/resources/zh_TW.json';
import { AppError } from '../AppError';
import { useServerFieldErrors } from '../useServerFieldErrors';

const FIELDS = ['currentPassword', 'newPassword'] as const;
const CONFLICTS = { AUTH_PASSWORD_MISMATCH: 'currentPassword' } as const;

beforeAll(async () => {
  await initI18n('zh-TW');
  i18n.addResourceBundle('zh-TW', 'translation', zhTW, true, true);
});

describe('useServerFieldErrors', () => {
  it('登記的衝突碼放到對應欄位，錯誤碼一併記在 codes', () => {
    const { result } = renderHook(() => useServerFieldErrors(FIELDS, CONFLICTS));
    let handled = false;
    act(() => {
      handled = result.current.report(new AppError('AUTH_PASSWORD_MISMATCH', 400));
    });
    expect(handled).toBe(true);
    expect(result.current.errors.currentPassword).toBeTruthy();
    expect(result.current.codes).toEqual({ currentPassword: 'AUTH_PASSWORD_MISMATCH' });
  });

  it('VALIDATION_FAILED 的 details.fields 只收認得的欄位，錯誤碼是 VALIDATION_FAILED', () => {
    const { result } = renderHook(() => useServerFieldErrors(FIELDS, CONFLICTS));
    act(() => {
      result.current.report(
        new AppError('VALIDATION_FAILED', 400, {
          fields: { newPassword: 'too short', other: 'x' },
        }),
      );
    });
    expect(result.current.codes).toEqual({ newPassword: 'VALIDATION_FAILED' });
    expect(result.current.errors.newPassword).toBeTruthy();
  });

  it('對應不到欄位 → 回傳 false，不動目前的錯誤', () => {
    const { result } = renderHook(() => useServerFieldErrors(FIELDS, CONFLICTS));
    let handled = true;
    act(() => {
      handled = result.current.report(new AppError('INTERNAL_ERROR', 500));
    });
    expect(handled).toBe(false);
    expect(result.current.codes).toEqual({});
  });

  it('clear 清掉該欄位的訊息與錯誤碼', () => {
    const { result } = renderHook(() => useServerFieldErrors(FIELDS, CONFLICTS));
    act(() => {
      result.current.report(new AppError('AUTH_PASSWORD_MISMATCH', 400));
    });
    act(() => result.current.clear('currentPassword'));
    expect(result.current.errors).toEqual({});
    expect(result.current.codes).toEqual({});
  });
});
