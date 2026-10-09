import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { AppError } from '../../errors';
import { initTestI18n } from '../../testing/i18n';
import { AllProviders } from '../../testing/renderWithPermissions';
import { MfaChallengeForm } from '../components/MfaChallengeForm';
import { MfaEnrollFlow } from '../components/MfaEnrollFlow';
import { lineMethod, telegramMethod } from '../methods/messaging';
import { smsMethod } from '../methods/sms';
import { toE164 } from '../methods/sms/SmsEnrollStart';
import { webauthnMethod } from '../methods/webauthn';
import type * as CeremonyExports from '../methods/webauthn/ceremony';
import { mfaMethodRegistry, registerMfaMethod } from '../registry';
import type { MfaChallengeInfo, MfaEnrollment, MfaFactorView, MfaMethodInfo } from '../types';

type CeremonyModule = typeof CeremonyExports;

const ceremony = vi.hoisted(() => ({ register: vi.fn(), authenticate: vi.fn() }));
vi.mock('../methods/webauthn/ceremony', async (importOriginal) => ({
  ...(await importOriginal<CeremonyModule>()),
  register: ceremony.register,
  authenticate: ceremony.authenticate,
  supportsWebAuthn: () => true,
}));

const info = (id: string, overrides: Partial<MfaMethodInfo> = {}): MfaMethodInfo => ({
  id,
  challenge: 'server',
  enrollChallenge: 'immediate',
  enrollAt: 'anywhere',
  assurance: 'messaging',
  maxFactorsPerAccount: 1,
  ...overrides,
});

const challengeInfo = (overrides: Partial<MfaChallengeInfo> = {}): MfaChallengeInfo => ({
  challengeId: 'c1',
  hint: null,
  expiresAt: new Date(Date.now() + 60_000).toISOString(),
  resendAvailableAt: new Date(Date.now() - 1_000).toISOString(),
  publicData: null,
  ...overrides,
});

const enrollment = (method: string, overrides: Partial<MfaEnrollment> = {}): MfaEnrollment => ({
  factorId: 'f1',
  method,
  publicData: {},
  challenge: null,
  ...overrides,
});

const factor = (method: string, overrides: Partial<MfaFactorView> = {}): MfaFactorView => ({
  id: `${method}-1`,
  method,
  label: null,
  hint: null,
  available: true,
  createdAt: '2026-10-09T00:00:00.000Z',
  lastUsedAt: null,
  ...overrides,
});

function renderFlow(
  props: Partial<Parameters<typeof MfaEnrollFlow>[0]> & { methods: MfaMethodInfo[] },
) {
  const handlers = {
    start: vi.fn(async (method: string) => enrollment(method)),
    confirm: vi.fn(async () => ({ recoveryCodes: null })),
    resend: vi.fn(async () => challengeInfo()),
    onDone: vi.fn(),
  };
  render(
    <AllProviders>
      <MfaEnrollFlow account="me@acme.test" {...handlers} {...props} />
    </AllProviders>,
  );
  return handlers;
}

beforeAll(() => initTestI18n());

beforeEach(() => {
  mfaMethodRegistry.reset();
  for (const method of [webauthnMethod, smsMethod, telegramMethod, lineMethod])
    registerMfaMethod(method);
  ceremony.register.mockReset();
  ceremony.authenticate.mockReset();
});

afterEach(() => vi.restoreAllMocks());

describe('簡訊（docs/architecture/backend/21-mfa.md §9.4）', () => {
  it.each([
    ['886', '0912-345-678', '+886912345678'],
    ['+1', '(415) 555 0100', '+14155550100'],
    ['886', '', ''],
  ])('toE164(%s, %s) → %s', (country, local, expected) => {
    expect(toE164(country, local)).toBe(expected);
  });

  it('選了簡訊：先輸入手機號碼，再以 input 開始設定；之後輸入簡訊的碼確認', async () => {
    const handlers = renderFlow({ methods: [info('sms')] });
    handlers.start.mockResolvedValue(
      enrollment('sms', { publicData: { phone: '+8869*****678' }, challenge: challengeInfo() }),
    );
    fireEvent.click(screen.getByTestId('mfa-enroll-method'));
    fireEvent.change(await screen.findByTestId('mfa-sms-phone'), {
      target: { value: '0912345678' },
    });
    expect(screen.getByTestId('mfa-sms-preview')).toHaveTextContent('+886912345678');
    fireEvent.click(screen.getByTestId('mfa-sms-start-submit'));
    await waitFor(() =>
      expect(handlers.start).toHaveBeenCalledWith('sms', { phone: '+886912345678' }),
    );

    fireEvent.change(await screen.findByTestId('mfa-sms-code'), { target: { value: '123456' } });
    fireEvent.click(screen.getByTestId('mfa-sms-confirm'));
    await waitFor(() =>
      expect(handlers.confirm).toHaveBeenCalledWith('f1', {
        payload: { code: '123456' },
        challengeId: 'c1',
      }),
    );
  });

  it('伺服器拒絕號碼的國碼：錯誤顯示在輸入號碼的步驟', async () => {
    const handlers = renderFlow({ methods: [info('sms')] });
    handlers.start.mockRejectedValue(
      new AppError('VALIDATION_FAILED', 400, {
        fields: { 'input.phone': 'MFA_PHONE_COUNTRY_NOT_ALLOWED' },
      }),
    );
    fireEvent.click(screen.getByTestId('mfa-enroll-method'));
    fireEvent.change(await screen.findByTestId('mfa-sms-phone'), {
      target: { value: '4155550100' },
    });
    fireEvent.click(screen.getByTestId('mfa-sms-start-submit'));
    expect(await screen.findByTestId('mfa-error')).toHaveAttribute(
      'data-value',
      'VALIDATION_FAILED',
    );
    expect(screen.getByTestId('mfa-sms-start')).toBeInTheDocument();
  });
});

describe('通訊軟體（§9.5）', () => {
  it('綁定的說明 → 請求驗證碼（還沒綁定時顯示錯誤）→ 綁定後輸入碼', async () => {
    const handlers = renderFlow({ methods: [info('telegram', { enrollChallenge: 'onRequest' })] });
    handlers.start.mockResolvedValue(
      enrollment('telegram', {
        publicData: {
          linkUrl: 'https://t.me/acme_bot?start=abc',
          code: '/start abc',
          botName: '@acme_bot',
        },
      }),
    );
    handlers.resend
      .mockRejectedValueOnce(new AppError('MFA_CHANNEL_NOT_LINKED', 409))
      .mockResolvedValueOnce(challengeInfo({ hint: '@alice' }));
    fireEvent.click(screen.getByTestId('mfa-enroll-method'));

    expect(await screen.findByTestId('mfa-telegram-link-code')).toHaveAttribute(
      'data-value',
      '/start abc',
    );
    fireEvent.click(screen.getByTestId('mfa-telegram-request'));
    expect(await screen.findByTestId('mfa-error')).toHaveAttribute(
      'data-value',
      'MFA_CHANNEL_NOT_LINKED',
    );

    fireEvent.click(screen.getByTestId('mfa-telegram-request'));
    expect(await screen.findByTestId('mfa-telegram-enroll-code')).toHaveTextContent('@alice');
    expect(handlers.resend).toHaveBeenCalledTimes(2);
  });

  it('LINE 多一步「加入好友」', async () => {
    const handlers = renderFlow({ methods: [info('line', { enrollChallenge: 'onRequest' })] });
    handlers.start.mockResolvedValue(
      enrollment('line', {
        publicData: {
          linkUrl: 'https://line.me/R/oaMessage/%40bot/?K7Q2-M9XD',
          addFriendUrl: 'https://line.me/R/ti/p/%40bot',
          code: 'K7Q2-M9XD',
          botName: '@bot',
        },
      }),
    );
    fireEvent.click(screen.getByTestId('mfa-enroll-method'));
    expect(await screen.findByRole('link')).toHaveAttribute(
      'href',
      'https://line.me/R/ti/p/%40bot',
    );
  });

  it('登入的第二步：先請伺服器送出，再輸入收到的碼', async () => {
    const requestChallenge = vi.fn(async () => challengeInfo({ hint: '@alice' }));
    const verify = vi.fn(async () => undefined);
    render(
      <AllProviders>
        <MfaChallengeForm
          factors={[factor('telegram', { hint: '@alice' })]}
          recoveryAvailable={false}
          requestChallenge={requestChallenge}
          verify={verify}
        />
      </AllProviders>,
    );
    fireEvent.click(await screen.findByTestId('mfa-telegram-send'));
    fireEvent.change(await screen.findByTestId('mfa-code'), { target: { value: '654321' } });
    fireEvent.click(screen.getByTestId('mfa-submit'));
    await waitFor(() =>
      expect(verify).toHaveBeenCalledWith('telegram-1', {
        payload: { code: '654321' },
        challengeId: 'c1',
      }),
    );
  });
});

describe('WebAuthn（§9.3）', () => {
  it('只能在 apps/platform 設定的方式：有 onEnrollElsewhere 時交給它（backstage 改走重新登入）', async () => {
    const onEnrollElsewhere = vi.fn();
    const handlers = renderFlow({
      methods: [info('webauthn', { enrollAt: 'idp' })],
      onEnrollElsewhere,
    });
    fireEvent.click(await screen.findByTestId('mfa-enroll-method'));
    expect(onEnrollElsewhere).toHaveBeenCalledWith(expect.objectContaining({ id: 'webauthn' }));
    expect(handlers.start).not.toHaveBeenCalled();
  });

  it('註冊：按下按鈕呼叫瀏覽器 API，回應與名稱一起送出', async () => {
    const options = { challenge: 'abc' };
    const handlers = renderFlow({ methods: [info('webauthn', { enrollAt: 'idp' })] });
    handlers.start.mockResolvedValue(
      enrollment('webauthn', { challenge: challengeInfo({ publicData: { options } }) }),
    );
    ceremony.register.mockResolvedValue({ id: 'cred' });
    fireEvent.click(screen.getByTestId('mfa-enroll-method'));
    fireEvent.change(await screen.findByTestId('mfa-webauthn-label'), {
      target: { value: 'YubiKey' },
    });
    fireEvent.click(screen.getByTestId('mfa-webauthn-register'));
    await waitFor(() =>
      expect(handlers.confirm).toHaveBeenCalledWith('f1', {
        payload: { response: { id: 'cred' } },
        label: 'YubiKey',
        challengeId: 'c1',
      }),
    );
    expect(ceremony.register).toHaveBeenCalledWith(
      expect.objectContaining({ publicData: { options } }),
    );
  });

  it('使用者取消：顯示可以重試的訊息，不送出', async () => {
    const handlers = renderFlow({ methods: [info('webauthn')] });
    handlers.start.mockResolvedValue(
      enrollment('webauthn', { challenge: challengeInfo({ publicData: { options: {} } }) }),
    );
    ceremony.register.mockRejectedValue(
      Object.assign(new Error('cancel'), { name: 'NotAllowedError' }),
    );
    fireEvent.click(screen.getByTestId('mfa-enroll-method'));
    fireEvent.click(await screen.findByTestId('mfa-webauthn-register'));
    expect(await screen.findByTestId('mfa-error')).toHaveTextContent('已取消或逾時');
    expect(handlers.confirm).not.toHaveBeenCalled();
  });

  it('登入：選到因子時自動取得 challenge，按下按鈕後送出瀏覽器的回應', async () => {
    const requestChallenge = vi.fn(async () =>
      challengeInfo({ publicData: { options: { challenge: 'x' } } }),
    );
    const verify = vi.fn(async () => undefined);
    ceremony.authenticate.mockResolvedValue({ id: 'cred' });
    render(
      <AllProviders>
        <MfaChallengeForm
          factors={[factor('webauthn', { label: 'YubiKey' })]}
          recoveryAvailable={false}
          requestChallenge={requestChallenge}
          verify={verify}
        />
      </AllProviders>,
    );
    await waitFor(() => expect(requestChallenge).toHaveBeenCalledTimes(1));
    expect(await screen.findByTestId('mfa-webauthn-challenge')).toHaveTextContent('YubiKey');
    fireEvent.click(screen.getByTestId('mfa-webauthn-authenticate'));
    await waitFor(() =>
      expect(verify).toHaveBeenCalledWith('webauthn-1', {
        payload: { response: { id: 'cred' } },
        challengeId: 'c1',
      }),
    );
  });
});
