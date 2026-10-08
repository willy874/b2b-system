import { i18n } from '@b2b-system/web-core/locales';
import { useLocaleStore } from '@b2b-system/web-core/store';
import { AllProviders } from '@b2b-system/web-core/testing';
import { Languages } from '@b2b-system/web-shared/constants';
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import { initTestI18n } from '@/test/i18n';

import { useChangeLocale } from '../useChangeLocale';

beforeAll(() => initTestI18n());

afterEach(async () => {
  useLocaleStore.getState().setLocale(Languages.ZH_TW);
  await i18n.changeLanguage(Languages.ZH_TW);
  localStorage.clear();
});

describe('useChangeLocale（切換介面語系，只存在本機）', () => {
  it('寫入本機偏好並切換 i18n 的語系', async () => {
    const { result } = renderHook(() => useChangeLocale(), { wrapper: AllProviders });
    act(() => result.current(Languages.EN_US));

    expect(useLocaleStore.getState().locale).toBe(Languages.EN_US);
    expect(JSON.stringify(localStorage)).toContain(Languages.EN_US);
    await waitFor(() => expect(i18n.language).toBe(Languages.EN_US));
  });

  it('rerender 時回傳同一個函式（可放進依賴陣列）', () => {
    const { result, rerender } = renderHook(() => useChangeLocale(), { wrapper: AllProviders });
    const first = result.current;
    rerender();
    expect(result.current).toBe(first);
  });
});
