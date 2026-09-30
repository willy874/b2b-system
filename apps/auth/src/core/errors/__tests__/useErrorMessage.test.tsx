import { renderHook } from '@testing-library/react';
import { beforeAll, describe, expect, it } from 'vitest';

import zhTW from '@/app/locales/zh_TW.json';
import { AbortReason, NetworkError, RequestAbortedError } from '@/core/client';
import { i18n, initI18n } from '@/core/locales';

import { AppError } from '../AppError';
import { isSilentError, useErrorMessage } from '../useErrorMessage';

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

  it('details 的純量值帶進訊息（例：ROLE_IN_USE 的持有人數）', () => {
    const { result } = renderHook(() => useErrorMessage());
    expect(result.current(new AppError('ROLE_IN_USE', 409, { userCount: 3 }))).toBe(
      '仍有 3 位使用者持有這個角色。',
    );
  });

  it('非 AppError 一律通用訊息', () => {
    const { result } = renderHook(() => useErrorMessage());
    expect(result.current(new Error('boom'))).toBe('發生未預期的錯誤，請稍後再試。');
  });

  it('網路錯誤顯示連線訊息', () => {
    const { result } = renderHook(() => useErrorMessage());
    expect(result.current(new NetworkError(new TypeError('Failed to fetch')))).toBe(
      '無法連線到伺服器，請檢查網路後再試。',
    );
  });

  it('逾時顯示逾時訊息', () => {
    const { result } = renderHook(() => useErrorMessage());
    expect(result.current(new RequestAbortedError(AbortReason.TIMEOUT))).toBe(
      '請求逾時，請檢查網路連線後再試。',
    );
  });
});

describe('isSilentError', () => {
  it('呼叫端取消與 session 結束的中止不提示；逾時與伺服器錯誤要提示', () => {
    expect(isSilentError(new RequestAbortedError(AbortReason.CALLER))).toBe(true);
    expect(isSilentError(new RequestAbortedError(AbortReason.SESSION_ENDED))).toBe(true);
    expect(isSilentError(new RequestAbortedError(AbortReason.TIMEOUT))).toBe(false);
    expect(isSilentError(new AppError('INTERNAL_ERROR', 500))).toBe(false);
  });
});
