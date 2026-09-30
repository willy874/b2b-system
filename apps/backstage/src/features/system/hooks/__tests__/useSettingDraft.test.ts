import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import type { SettingFieldView } from '../../types';
import { useSettingDraft, validateSettingValue } from '../useSettingDraft';

function field(overrides: Partial<SettingFieldView> = {}): SettingFieldView {
  return {
    key: 'auth.loginMaxAttempts',
    type: 'number',
    value: 5,
    defaultValue: 5,
    isOverridden: false,
    minimum: 3,
    maximum: 20,
    ...overrides,
  };
}

describe('useSettingDraft（系統設定頁的編輯草稿）', () => {
  it('改值之後出現在 changes，畫面顯示新值並標為覆寫', () => {
    const attempts = field();
    const { result } = renderHook(() => useSettingDraft([attempts]));
    act(() => result.current.setValue(attempts, 8));
    expect(result.current.changes).toEqual({ 'auth.loginMaxAttempts': 8 });
    expect(result.current.isDirty).toBe(true);
    expect(result.current.current(attempts)).toEqual({ value: 8, isOverridden: true });
  });

  it('改回伺服器上的值 → 從草稿移除，不送出沒有變化的修改', () => {
    const attempts = field();
    const { result } = renderHook(() => useSettingDraft([attempts]));
    act(() => result.current.setValue(attempts, 8));
    act(() => result.current.setValue(attempts, 5));
    expect(result.current.changes).toEqual({});
    expect(result.current.isDirty).toBe(false);
  });

  it('還原有覆寫的設定 → 送出 null，畫面顯示預設值', () => {
    const attempts = field({ value: 8, isOverridden: true });
    const { result } = renderHook(() => useSettingDraft([attempts]));
    act(() => result.current.resetToDefault(attempts));
    expect(result.current.changes).toEqual({ 'auth.loginMaxAttempts': null });
    expect(result.current.current(attempts)).toEqual({ value: 5, isOverridden: false });
  });

  it('還原沒有覆寫的設定 → 什麼都不送', () => {
    const attempts = field();
    const { result } = renderHook(() => useSettingDraft([attempts]));
    act(() => result.current.setValue(attempts, 8));
    act(() => result.current.resetToDefault(attempts));
    expect(result.current.changes).toEqual({});
  });

  it('超出範圍的值出現在 errors；clear 清掉草稿與錯誤', () => {
    const attempts = field();
    const { result } = renderHook(() => useSettingDraft([attempts]));
    act(() => result.current.setValue(attempts, 50));
    expect(result.current.errors).toEqual({ 'auth.loginMaxAttempts': 'range' });
    act(() => result.current.clear());
    expect(result.current.errors).toEqual({});
    expect(result.current.isDirty).toBe(false);
  });
});

describe('validateSettingValue', () => {
  it.each([
    [Number.NaN, 'required'],
    [3.5, 'integer'],
    [2, 'range'],
    [21, 'range'],
    [3, undefined],
    [20, undefined],
    [null, undefined],
  ] as const)('%s → %s', (value, expected) => {
    expect(validateSettingValue(field(), value)).toBe(expected);
  });

  it('非數值的設定不檢查範圍', () => {
    expect(validateSettingValue(field({ type: 'boolean', value: true }), false)).toBeUndefined();
  });
});
