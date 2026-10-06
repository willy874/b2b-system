import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import { AbortReason, NetworkError, RequestAbortedError } from '../../client';
import { i18n, initI18n } from '../../locales';
import enUS from '../../locales/resources/en_US.json';
import zhTW from '../../locales/resources/zh_TW.json';
import { AppError } from '../AppError';
import { isSilentError, useErrorMessage } from '../useErrorMessage';

beforeAll(async () => {
  await initI18n('zh-TW');
  i18n.addResourceBundle('zh-TW', 'translation', zhTW, true, true);
  i18n.addResourceBundle('en-US', 'translation', enUS, true, true);
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

  it('429 帶等待秒數時告訴使用者幾秒後可以再試', () => {
    const { result } = renderHook(() => useErrorMessage());
    const error = new AppError('RATE_LIMITED', 429, { retryAfterSeconds: 42 });
    expect(result.current(error)).toBe('操作太頻繁，請在 42 秒後再試。');
    expect(result.current(new AppError('RATE_LIMITED', 429))).toBe('操作太頻繁，請稍後再試。');
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

  describe('英文的單複數（docs/architecture/frontend/08-i18n.md §5）', () => {
    afterEach(async () => {
      await act(() => i18n.changeLanguage('zh-TW'));
    });

    it('ROLE_IN_USE 的人數以 count 套用複數規則：1 user／3 users', async () => {
      await act(() => i18n.changeLanguage('en-US'));
      const { result } = renderHook(() => useErrorMessage());
      expect(result.current(new AppError('ROLE_IN_USE', 409, { userCount: 1 }))).toBe(
        '1 user still holds this role.',
      );
      expect(result.current(new AppError('ROLE_IN_USE', 409, { userCount: 3 }))).toBe(
        '3 users still hold this role.',
      );
    });

    it('429 的等待秒數：1 second／42 seconds', async () => {
      await act(() => i18n.changeLanguage('en-US'));
      const { result } = renderHook(() => useErrorMessage());
      expect(result.current(new AppError('RATE_LIMITED', 429, { retryAfterSeconds: 1 }))).toBe(
        'Too many requests. Please try again in 1 second.',
      );
      expect(result.current(new AppError('RATE_LIMITED', 429, { retryAfterSeconds: 42 }))).toBe(
        'Too many requests. Please try again in 42 seconds.',
      );
    });
  });
});
