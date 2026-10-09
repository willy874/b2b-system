import { AppError } from '@b2b-system/web-core/errors';
import { i18n } from '@b2b-system/web-core/locales';
import { mfaMethodRegistry, registerMfaMethod, totpMethod } from '@b2b-system/web-core/mfa';
import { parseSearch, RootRoute, stringifySearch } from '@b2b-system/web-core/router';
import { useLocaleStore } from '@b2b-system/web-core/store';
import { AllProviders } from '@b2b-system/web-core/testing';
import { createMemoryHistory, createRouter, RouterProvider } from '@tanstack/react-router';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { initTestI18n } from '@/test/i18n';

import { Routes } from '../../..';

const { details, login, abort, discover, startExternal, publicSettings, verifyMfa, skipEnroll } =
  vi.hoisted(() => ({
    verifyMfa: vi.fn(),
    skipEnroll: vi.fn(),
    publicSettings: vi.fn(),
    details: vi.fn(),
    login: vi.fn(),
    abort: vi.fn(),
    discover: vi.fn(),
    startExternal: vi.fn(),
  }));

vi.mock('@/apis/sso-interaction/get-sso-interaction/query', () => ({
  SSO_INTERACTION_QUERY_KEY: 'SSO_INTERACTION_QUERY_KEY',
  getSsoInteractionQueryOptions: (uid: string) => ({
    queryKey: ['SSO_INTERACTION_QUERY_KEY', uid],
    queryFn: details,
    retry: false,
  }),
}));
vi.mock('@/apis/auth/get-public-settings/query', () => ({
  PUBLIC_SETTINGS_QUERY_KEY: 'PUBLIC_SETTINGS_QUERY_KEY',
  getPublicSettingsQueryOptions: (tenant: string) => ({
    queryKey: ['PUBLIC_SETTINGS_QUERY_KEY', tenant],
    queryFn: () => publicSettings(tenant),
  }),
}));
vi.mock('@/apis/sso-interaction/login-sso-interaction/mutation', () => ({
  getLoginSsoInteractionMutationOptions: () => ({ mutationFn: login }),
}));
vi.mock('@/apis/sso-interaction/abort-sso-interaction/mutation', () => ({
  getAbortSsoInteractionMutationOptions: () => ({ mutationFn: abort }),
}));
vi.mock('@/apis/sso-interaction/discover-sso-interaction/query', () => ({
  SSO_DISCOVERY_QUERY_KEY: 'SSO_DISCOVERY_QUERY_KEY',
  getSsoDiscoveryQueryOptions: (uid: string, email: string) => ({
    queryKey: ['SSO_DISCOVERY_QUERY_KEY', uid, email],
    queryFn: () => discover(email),
    retry: false,
  }),
}));
vi.mock('@/apis/sso-interaction/verify-mfa-sso-interaction/mutation', () => ({
  getVerifyMfaSsoInteractionMutationOptions: () => ({ mutationFn: verifyMfa }),
}));
vi.mock('@/apis/sso-interaction/skip-mfa-enrollment-sso-interaction/mutation', () => ({
  getSkipMfaEnrollmentSsoInteractionMutationOptions: () => ({ mutationFn: skipEnroll }),
}));
vi.mock('@/apis/sso-interaction/start-external-sso-interaction/mutation', () => ({
  getStartExternalSsoInteractionMutationOptions: () => ({ mutationFn: startExternal }),
}));

const UID = 'abc12345xyz';
const TENANT_INTERACTION = {
  uid: UID,
  prompt: 'login',
  clientId: 'backstage',
  clientName: 'backstage',
  loginHint: null,
  uiLocales: null,
  tenant: { code: 'acme', name: 'Acme 股份有限公司' },
  mfaEnroll: null,
};
const RESUME = `http://localhost:5175/api/oidc/auth/${UID}`;
const assign = vi.fn();

const ACME = { id: '22222222-2222-4222-8222-222222222222', name: 'Acme Azure AD' };
const EXTERNAL_AUTHORIZE = 'https://login.acme.test/authorize?state=s';

function renderInteraction(query = '') {
  const router = createRouter({
    routeTree: RootRoute.addChildren([
      Routes.InteractionRoute,
      Routes.EnterTenantRoute,
      Routes.LoginRoute,
    ]),
    history: createMemoryHistory({ initialEntries: [`/interaction/${UID}${query}`] }),
    parseSearch,
    stringifySearch,
  });
  return render(
    <AllProviders>
      <RouterProvider router={router} />
    </AllProviders>,
  );
}

beforeEach(() => {
  details.mockReset().mockResolvedValue(TENANT_INTERACTION);
  publicSettings.mockReset().mockResolvedValue({
    values: { 'auth.registrationEnabled': true, 'auth.passwordMinLength': 12 },
  });
  login.mockReset().mockResolvedValue({ redirectTo: RESUME });
  abort.mockReset().mockResolvedValue({ redirectTo: `${RESUME}?aborted` });
  discover.mockReset().mockResolvedValue({ provider: null, ssoOnly: false });
  startExternal.mockReset().mockResolvedValue({ redirectTo: EXTERNAL_AUTHORIZE });
  assign.mockReset();
  // 頂層跳轉：jsdom 的 location.assign 不能 spy，整個換掉（router 用 memory history，不受影響）
  vi.stubGlobal('location', { ...window.location, assign });
  // router 換頁後會捲回頂端；jsdom 沒有實作 scrollTo
  vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// 錯誤訊息要是真的翻譯，才能斷言 role="alert" 裡的文字
beforeAll(async () => {
  await initTestI18n();
  mfaMethodRegistry.reset();
  registerMfaMethod(totpMethod);
});

describe('IdP 的登入互動頁（docs/architecture/04-sso.md §12）', () => {
  it('租戶的互動：帳號流程的連結帶上租戶代碼（docs/architecture/05-tenancy.md §10.2 D8）', async () => {
    renderInteraction();
    expect(await screen.findByTestId('login-register-link')).toHaveAttribute(
      'href',
      '/register?tenant=acme',
    );
    expect(screen.getByTestId('login-forgot-password-link')).toHaveAttribute(
      'href',
      '/forgot-password?tenant=acme',
    );
  });

  it('租戶關閉了註冊（auth.registrationEnabled）→ 沒有註冊連結，忘記密碼照常', async () => {
    publicSettings.mockResolvedValue({ values: { 'auth.registrationEnabled': false } });
    renderInteraction();
    expect(await screen.findByTestId('login-forgot-password-link')).toBeInTheDocument();
    await waitFor(() => expect(publicSettings).toHaveBeenCalledWith('acme'));
    expect(screen.queryByTestId('login-register-link')).not.toBeInTheDocument();
  });

  it('平台管理者的互動（沒有租戶）：沒有註冊與忘記密碼的連結，有進入租戶的連結', async () => {
    details.mockResolvedValue({
      uid: UID,
      prompt: 'login',
      clientId: 'auth',
      clientName: 'auth',
      loginHint: null,
      uiLocales: null,
      tenant: null,
    });
    renderInteraction();
    expect(await screen.findByTestId('login-email')).toBeInTheDocument();
    expect(screen.queryByTestId('login-register-link')).not.toBeInTheDocument();
    expect(screen.queryByTestId('login-forgot-password-link')).not.toBeInTheDocument();
    // 走錯地方的租戶使用者：去「進入租戶」（docs/architecture/05-tenancy.md §10.2 D11）
    expect(screen.getByTestId('login-enter-tenant-link')).toHaveAttribute('href', '/enter');
  });

  it('登入成功 → 以互動 id 送出帳密，並頂層跳轉到 resume 網址', async () => {
    renderInteraction();
    fireEvent.change(await screen.findByTestId('login-email'), {
      target: { value: 'user@example.com' },
    });
    fireEvent.change(screen.getByTestId('login-password'), { target: { value: 'secret-123' } });
    await waitFor(() => expect(screen.getByTestId('login-submit')).not.toBeDisabled());
    fireEvent.click(screen.getByTestId('login-submit'));

    await waitFor(() => expect(assign).toHaveBeenCalledWith(RESUME));
    expect(login.mock.calls[0]?.[0]).toEqual({
      params: { uid: UID, email: 'user@example.com', password: 'secret-123' },
    });
  });

  it('帳密錯誤時顯示錯誤、不跳轉', async () => {
    login.mockRejectedValue(new Error('AUTH_INVALID_CREDENTIALS'));
    renderInteraction();
    fireEvent.change(await screen.findByTestId('login-email'), {
      target: { value: 'user@example.com' },
    });
    fireEvent.change(screen.getByTestId('login-password'), { target: { value: 'wrong' } });
    await waitFor(() => expect(screen.getByTestId('login-submit')).not.toBeDisabled());
    fireEvent.click(screen.getByTestId('login-submit'));

    await waitFor(() => expect(login).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByTestId('login-submit')).not.toBeDisabled());
    expect(assign).not.toHaveBeenCalled();
  });

  it('送出失敗的錯誤碼放在 login-error 的 data-value（E2E 不依語系的文字分辨）', async () => {
    login.mockRejectedValue(new AppError('AUTH_ACCOUNT_LOCKED', 403));
    renderInteraction();
    fireEvent.change(await screen.findByTestId('login-email'), {
      target: { value: 'user@example.com' },
    });
    fireEvent.change(screen.getByTestId('login-password'), { target: { value: 'secret-123' } });
    await waitFor(() => expect(screen.getByTestId('login-submit')).not.toBeDisabled());
    fireEvent.click(screen.getByTestId('login-submit'));

    await waitFor(() =>
      expect(screen.getByTestId('login-error')).toHaveAttribute(
        'data-value',
        'AUTH_ACCOUNT_LOCKED',
      ),
    );
  });

  it('密碼錯誤 → 錯誤訊息在 role="alert" 裡，報讀器會立即念出（docs/architecture/frontend/07-ui-system.md §5）', async () => {
    login.mockRejectedValue(new AppError('AUTH_INVALID_CREDENTIALS', 401));
    renderInteraction();
    fireEvent.change(await screen.findByTestId('login-email'), {
      target: { value: 'user@example.com' },
    });
    fireEvent.change(screen.getByTestId('login-password'), { target: { value: 'wrong-123' } });
    await waitFor(() => expect(screen.getByTestId('login-submit')).not.toBeDisabled());
    fireEvent.click(screen.getByTestId('login-submit'));

    await waitFor(() => expect(screen.getByRole('alert')).not.toBeEmptyDOMElement());
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('帳號或密碼錯誤');
    expect(alert).toHaveAttribute('data-value', 'AUTH_INVALID_CREDENTIALS');
  });

  it('被限流（429）→ 倒數期間停用送出鈕並顯示剩餘秒數，數完恢復、訊息收起', async () => {
    login.mockRejectedValue(new AppError('RATE_LIMITED', 429, { retryAfterSeconds: 1 }));
    renderInteraction();
    fireEvent.change(await screen.findByTestId('login-email'), {
      target: { value: 'user@example.com' },
    });
    fireEvent.change(screen.getByTestId('login-password'), { target: { value: 'secret-123' } });
    await waitFor(() => expect(screen.getByTestId('login-submit')).not.toBeDisabled());
    fireEvent.click(screen.getByTestId('login-submit'));

    // 這裡沒有載入 login 的語系包（按鈕是原始 key）；剩餘秒數以 web-core 的限流訊息斷言
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('請在 1 秒後再試'));
    expect(screen.getByTestId('login-submit')).toBeDisabled();

    // 真的等倒數走完（約 1 秒），測試的上限比預設的 5 秒寬一些
    await waitFor(() => expect(screen.getByTestId('login-submit')).not.toBeDisabled(), {
      timeout: 3000,
    });
    expect(screen.getByRole('alert')).toBeEmptyDOMElement();
  }, 10_000);

  describe('產品要求的介面語系（OIDC ui_locales）', () => {
    afterEach(async () => {
      useLocaleStore.setState({ locale: 'zh-TW' });
      await i18n.changeLanguage('zh-TW');
    });

    it('帶 ui_locales=en-US → 登入頁切成英文，並記在這個瀏覽器', async () => {
      details.mockResolvedValue({ ...TENANT_INTERACTION, uiLocales: 'en-US' });
      renderInteraction();
      await waitFor(() => expect(i18n.language).toBe('en-US'));
      expect(useLocaleStore.getState().locale).toBe('en-US');
    });

    it('依序取第一個支援的語系（ja 不支援、en-GB 對到 en-US）', async () => {
      details.mockResolvedValue({ ...TENANT_INTERACTION, uiLocales: 'ja en-GB' });
      renderInteraction();
      await waitFor(() => expect(useLocaleStore.getState().locale).toBe('en-US'));
    });

    it('沒帶 → 維持這個瀏覽器的語系', async () => {
      renderInteraction();
      await screen.findByTestId('login-email');
      await waitFor(() => expect(details).toHaveBeenCalled());
      expect(useLocaleStore.getState().locale).toBe('zh-TW');
      expect(i18n.language).toBe('zh-TW');
    });
  });

  it('取消 → 頂層跳轉到 provider（產品收到 access_denied）', async () => {
    renderInteraction();
    await waitFor(() => expect(screen.getByTestId('login-cancel')).not.toBeDisabled());
    fireEvent.click(screen.getByTestId('login-cancel'));
    await waitFor(() => expect(assign).toHaveBeenCalledWith(`${RESUME}?aborted`));
    expect(abort.mock.calls[0]?.[0]).toEqual({ params: { uid: UID } });
  });

  it('互動無效（過期、沒有互動 cookie）→ 顯示錯誤，沒有表單', async () => {
    details.mockRejectedValue(new Error('AUTH_SSO_INTERACTION_INVALID'));
    renderInteraction();
    expect(await screen.findByTestId('interaction-invalid')).toBeInTheDocument();
    expect(screen.queryByTestId('login-submit')).toBeNull();
  });

  describe('外部 IdP（docs/architecture/04-sso.md §12.2 D8、D9）', () => {
    async function typeEmail(email: string) {
      const input = await screen.findByTestId('login-email');
      fireEvent.change(input, { target: { value: email } });
      fireEvent.blur(input);
    }

    it('網域沒有連線 → 只有密碼登入', async () => {
      renderInteraction();
      await typeEmail('user@example.com');
      await waitFor(() => expect(discover).toHaveBeenCalledWith('user@example.com'));
      expect(screen.queryByTestId('login-external')).toBeNull();
      expect(screen.getByTestId('login-password')).toBeInTheDocument();
    });

    it('網域有連線 → 多一個「使用 X 登入」，按下後頂層跳轉到外部 IdP', async () => {
      discover.mockResolvedValue({ provider: ACME, ssoOnly: false });
      renderInteraction();
      await typeEmail('alice@acme.test');
      const button = await screen.findByTestId('login-external');
      expect(button).toHaveAttribute('data-value', ACME.id);
      expect(screen.getByTestId('login-password')).toBeInTheDocument();
      await waitFor(() => expect(button).not.toBeDisabled());
      fireEvent.click(button);
      await waitFor(() => expect(assign).toHaveBeenCalledWith(EXTERNAL_AUTHORIZE));
      expect(startExternal.mock.calls[0]?.[0]).toEqual({
        params: { uid: UID, providerId: ACME.id },
      });
      expect(login).not.toHaveBeenCalled();
    });

    it('只允許 SSO 的網域 → 沒有密碼欄，送出表單就走外部 IdP', async () => {
      discover.mockResolvedValue({ provider: ACME, ssoOnly: true });
      renderInteraction();
      await typeEmail('alice@acme.test');
      expect(await screen.findByTestId('login-sso-only')).toBeInTheDocument();
      expect(screen.queryByTestId('login-password')).toBeNull();
      expect(screen.queryByTestId('login-submit')).toBeNull();
      await waitFor(() => expect(screen.getByTestId('login-external')).not.toBeDisabled());
      fireEvent.submit(screen.getByTestId('login-email').closest('form')!);
      await waitFor(() => expect(assign).toHaveBeenCalledWith(EXTERNAL_AUTHORIZE));
    });

    it('不完整的 email 不查詢網域', async () => {
      renderInteraction();
      await typeEmail('alice@');
      await waitFor(() => expect(screen.getByTestId('login-email')).toBeInTheDocument());
      expect(discover).not.toHaveBeenCalled();
    });

    it('外部登入失敗帶回的錯誤碼 → 顯示對應訊息', async () => {
      renderInteraction('?error=AUTH_SSO_ACCOUNT_NOT_FOUND');
      const error = await screen.findByRole('alert');
      expect(error).toHaveAttribute('data-value', 'AUTH_SSO_ACCOUNT_NOT_FOUND');
      expect(error).not.toBeEmptyDOMElement();
    });
  });

  it('互動已經找不到（過期）→ 提供重新開始登入：進入租戶與平台管理者登入', async () => {
    details.mockRejectedValue(new AppError('AUTH_SSO_INTERACTION_INVALID', 400));
    renderInteraction();
    expect(await screen.findByTestId('interaction-invalid')).toBeInTheDocument();
    expect(screen.getByTestId('login-restart')).toHaveAttribute('href', '/enter');
    expect(screen.getByTestId('login-restart-platform')).toHaveAttribute('href', '/login');
  });

  it('送出時才發現互動過期 → 回到那個租戶重新開始登入', async () => {
    login.mockRejectedValue(new AppError('AUTH_SSO_INTERACTION_INVALID', 400));
    renderInteraction();
    fireEvent.change(await screen.findByTestId('login-email'), {
      target: { value: 'user@example.com' },
    });
    fireEvent.change(screen.getByTestId('login-password'), { target: { value: 'secret-123' } });
    await waitFor(() => expect(screen.getByTestId('login-submit')).not.toBeDisabled());
    fireEvent.click(screen.getByTestId('login-submit'));

    expect(await screen.findByTestId('login-restart')).toHaveAttribute(
      'href',
      '/enter?tenant=acme',
    );
    expect(screen.queryByTestId('login-restart-platform')).toBeNull();
    expect(screen.queryByTestId('login-submit')).toBeNull();
  });

  it('進頁面後游標在 Email 欄；密碼欄可以切換顯示', async () => {
    renderInteraction();
    const email = await screen.findByTestId('login-email');
    await waitFor(() => expect(email).toHaveFocus());

    const password = screen.getByTestId('login-password');
    expect(password).toHaveAttribute('type', 'password');
    fireEvent.click(screen.getByTestId('password-visibility-toggle'));
    expect(password).toHaveAttribute('type', 'text');
    expect(password).toHaveAttribute('autocomplete', 'current-password');
  });

  it('互動還在載入時已經移到密碼欄 → 載入完成後不把游標搶回 Email 欄', async () => {
    let resolveDetails: ((value: unknown) => void) | undefined;
    details.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveDetails = resolve;
        }),
    );
    renderInteraction();
    const password = await screen.findByTestId('login-password');
    password.focus();

    resolveDetails?.(TENANT_INTERACTION);
    await waitFor(() => expect(screen.getByTestId('login-submit')).not.toBeDisabled());

    expect(password).toHaveFocus();
  });
});

describe('登入互動的第二步（docs/architecture/backend/21-mfa.md §4）', () => {
  const MFA_NEXT = {
    next: 'mfa',
    factors: [
      {
        id: '33333333-3333-4333-8333-333333333333',
        method: 'totp',
        label: 'iPhone',
        hint: null,
        available: true,
        createdAt: '2026-10-07T00:00:00.000Z',
        lastUsedAt: null,
      },
    ],
    recoveryAvailable: true,
  };

  async function submitPassword() {
    renderInteraction();
    fireEvent.change(await screen.findByTestId('login-email'), {
      target: { value: 'user@example.com' },
    });
    fireEvent.change(screen.getByTestId('login-password'), { target: { value: 'secret-123' } });
    await waitFor(() => expect(screen.getByTestId('login-submit')).not.toBeDisabled());
    fireEvent.click(screen.getByTestId('login-submit'));
  }

  it('密碼通過、需要 MFA → 不跳轉，換成第二步；驗證成功才頂層跳轉', async () => {
    login.mockResolvedValue(MFA_NEXT);
    verifyMfa.mockResolvedValue({ redirectTo: RESUME });
    await submitPassword();
    expect(await screen.findByTestId('login-mfa')).toHaveAttribute('data-value', 'mfa');
    expect(assign).not.toHaveBeenCalled();

    fireEvent.change(await screen.findByTestId('mfa-code'), { target: { value: '123456' } });
    fireEvent.click(screen.getByTestId('mfa-submit'));
    await waitFor(() => expect(assign).toHaveBeenCalledWith(RESUME));
    expect(verifyMfa.mock.calls[0]?.[0]).toEqual({
      params: { uid: UID, factorId: MFA_NEXT.factors[0]!.id, payload: { code: '123456' } },
    });
  });

  it('第二步作廢（錯太多次）→ 回到密碼並顯示原因', async () => {
    login.mockResolvedValue(MFA_NEXT);
    verifyMfa.mockRejectedValue(new AppError('AUTH_MFA_TOO_MANY_ATTEMPTS', 400));
    await submitPassword();
    fireEvent.change(await screen.findByTestId('mfa-code'), { target: { value: '123456' } });
    fireEvent.click(screen.getByTestId('mfa-submit'));
    expect(await screen.findByTestId('login-error')).toHaveAttribute(
      'data-value',
      'AUTH_MFA_TOO_MANY_ATTEMPTS',
    );
    expect(screen.queryByTestId('login-mfa')).not.toBeInTheDocument();
  });

  describe('backstage 要求新增安全金鑰（docs/architecture/backend/21-mfa.md §7.1）', () => {
    const ENROLL_NEXT = {
      next: 'mfaEnroll' as const,
      optional: true,
      methods: [
        {
          id: 'totp',
          challenge: 'none' as const,
          enrollChallenge: 'immediate' as const,
          enrollAt: 'anywhere' as const,
          assurance: 'possession' as const,
          maxFactorsPerAccount: 5,
        },
      ],
    };

    it('互動帶 mfaEnroll → 先說明為什麼要重新驗證', async () => {
      details.mockResolvedValue({ ...TENANT_INTERACTION, mfaEnroll: 'webauthn' });
      renderInteraction();
      expect(await screen.findByTestId('login-mfa-enroll-notice')).toHaveAttribute(
        'data-value',
        'webauthn',
      );
    });

    it('第二步通過後換成可略過的設定；略過 → 頂層跳轉', async () => {
      login.mockResolvedValue(MFA_NEXT);
      verifyMfa.mockResolvedValue(ENROLL_NEXT);
      skipEnroll.mockReset().mockResolvedValue({ redirectTo: RESUME });
      await submitPassword();
      fireEvent.change(await screen.findByTestId('mfa-code'), { target: { value: '123456' } });
      fireEvent.click(screen.getByTestId('mfa-submit'));

      await waitFor(() =>
        expect(screen.getByTestId('login-mfa')).toHaveAttribute('data-value', 'mfaEnroll'),
      );
      expect(assign).not.toHaveBeenCalled();
      fireEvent.click(screen.getByTestId('mfa-enroll-cancel'));
      await waitFor(() => expect(assign).toHaveBeenCalledWith(RESUME));
      expect(skipEnroll.mock.calls[0]?.[0]).toEqual({ params: { uid: UID } });
    });

    it('政策要求的首次設定沒有略過鈕', async () => {
      login.mockResolvedValue({ ...ENROLL_NEXT, optional: false });
      await submitPassword();
      expect(await screen.findByTestId('login-mfa')).toHaveAttribute('data-value', 'mfaEnroll');
      expect(screen.queryByTestId('mfa-enroll-cancel')).not.toBeInTheDocument();
    });
  });
});
