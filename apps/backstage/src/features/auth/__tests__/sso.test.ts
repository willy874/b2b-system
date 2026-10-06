import { useLocaleStore } from '@b2b-system/web-core/store';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { startSsoLogin } from '../sso';

const { fetchCurrentTenant } = vi.hoisted(() => ({ fetchCurrentTenant: vi.fn() }));
vi.mock('@/apis/tenant/get-current-tenant/fetcher', () => ({
  fetchCurrentTenantQuery: fetchCurrentTenant,
}));

const assign = vi.fn();

beforeEach(() => {
  fetchCurrentTenant.mockReset().mockResolvedValue({ code: 'acme', name: 'Acme' });
  assign.mockReset();
  // 頂層跳轉：jsdom 的 location.assign 不能 spy，整個換掉
  vi.stubGlobal('location', { ...window.location, assign });
});

afterEach(() => {
  vi.unstubAllGlobals();
  useLocaleStore.setState({ locale: 'zh-TW' });
});

describe('startSsoLogin（docs/architecture/04-sso.md §12.2 D6）', () => {
  it('帶上租戶代碼與目前的介面語系（ui_locales）：apps/platform 的登入頁用同一個語言', async () => {
    useLocaleStore.setState({ locale: 'en-US' });
    await startSsoLogin('/users');

    const url = new URL(assign.mock.calls[0]?.[0] as string);
    expect(url.searchParams.get('tenant')).toBe('acme');
    expect(url.searchParams.get('ui_locales')).toBe('en-US');
  });
});
