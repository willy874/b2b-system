import { renderHook } from '@testing-library/react';
import { beforeAll, describe, expect, it } from 'vitest';

import zhTW from '@/app/locales/zh_TW.json';
import { i18n, initI18n } from '@/core/locales';

import { AppError } from '../AppError';
import { useErrorMessage } from '../useErrorMessage';

beforeAll(async () => {
  await initI18n('zh-TW');
  i18n.addResourceBundle('zh-TW', 'translation', zhTW, true, true);
});

describe('useErrorMessage', () => {
  it('已知錯誤碼顯示本地化訊息', () => {
    const { result } = renderHook(() => useErrorMessage());
    expect(result.current(new AppError('AUTHZ_FORBIDDEN', 403))).toBe('你沒有執行這個操作的權限。');
  });

  it('未知錯誤碼退回通用訊息 ＋ requestId（不顯示原始 key）', () => {
    const { result } = renderHook(() => useErrorMessage());
    const message = result.current(new AppError('SOMETHING_WEIRD', 500, undefined, 'req-9'));
    expect(message).toContain('req-9');
    expect(message).not.toContain('error.SOMETHING_WEIRD');
  });

  it('非 AppError 一律通用訊息', () => {
    const { result } = renderHook(() => useErrorMessage());
    expect(result.current(new Error('boom'))).toBe('發生未預期的錯誤，請稍後再試。');
  });
});
