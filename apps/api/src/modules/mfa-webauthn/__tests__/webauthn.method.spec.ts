import { beforeEach, describe, expect, it, vi } from 'vitest';

import { MfaMethodSettings } from '@/core/mfa';
import type { MfaAccountContext, MfaChallenge, MfaFactor } from '@/core/mfa';

import { WebAuthnMfaMethod } from '../webauthn.method';

const lib = vi.hoisted(() => ({
  generateRegistrationOptions: vi.fn(),
  generateAuthenticationOptions: vi.fn(),
  verifyRegistrationResponse: vi.fn(),
  verifyAuthenticationResponse: vi.fn(),
}));
vi.mock('@simplewebauthn/server', () => lib);

const config = { get: () => 'https://auth.example.com' } as never;

function build(
  values: Record<string, string> = {
    rpName: 'B2B',
    userVerification: 'preferred',
    authenticatorAttachment: 'any',
  },
) {
  const settings = new MfaMethodSettings();
  settings.bind({ get: () => values });
  return new WebAuthnMfaMethod({ register: vi.fn() } as never, settings, config);
}

function ctx(factors: MfaFactor[] = []): MfaAccountContext {
  return {
    realm: 'tenant',
    account: {
      id: 'u1',
      email: 'a@example.com',
      displayName: 'Alice',
      locale: 'zh-TW',
      realm: 'tenant',
      tenant: { id: 't1', code: 'acme', name: 'Acme' },
    },
    secrets: {} as never,
    enqueue: vi.fn(),
    activeFactors: vi.fn(async () => factors),
  };
}

function factor(overrides: Partial<MfaFactor> = {}): MfaFactor {
  return {
    id: 'f1',
    accountId: 'u1',
    method: 'webauthn',
    label: 'YubiKey',
    status: 'active',
    secretEncrypted: null,
    config: {
      credentialId: 'cred-1',
      publicKey: Buffer.from('pk').toString('base64url'),
      rpId: 'example.com',
      transports: ['usb'],
    },
    lastUsedCounter: null,
    lastUsedAt: null,
    interactionUid: null,
    createdAt: new Date(),
    confirmedAt: new Date(),
    ...overrides,
  };
}

function challenge(
  purpose: 'login' | 'enroll',
  state: Record<string, unknown> = { challenge: 'ch', rpId: 'auth.example.com' },
): MfaChallenge {
  return {
    id: 'c1',
    factorId: 'f1',
    purpose,
    state,
    attempts: 0,
    expiresAt: new Date(Date.now() + 60_000),
    resendAfter: new Date(),
    consumedAt: null,
    createdAt: new Date(),
  };
}

beforeEach(() => {
  for (const fn of Object.values(lib)) fn.mockReset();
});

describe('WebAuthn（docs/architecture/backend/21-mfa.md §9.3）', () => {
  it('定義：綁 origin（enrollAt idp）、能防釣魚、需要參數所以預設關閉', () => {
    expect(build().definition).toMatchObject({
      id: 'webauthn',
      enrollAt: 'idp',
      challenge: 'server',
      assurance: 'phishingResistant',
      defaultEnabled: false,
    });
  });

  it.each([
    ['', true],
    ['auth.example.com', true],
    ['example.com', true],
    ['other.com', false],
    ['xample.com', false],
  ])('RP ID「%s」→ %s（必須是 apps/platform 的網域或上層網域）', async (rpId, ok) => {
    const result = await build().checkSettings({ rpId });
    expect(result.ok).toBe(ok);
  });

  it('註冊：預設 RP ID 是 apps/platform 的網域，排除已註冊的憑證，user handle 不是 email', async () => {
    lib.generateRegistrationOptions.mockResolvedValue({ challenge: 'reg-ch' });
    const start = await build().startChallenge(
      ctx([factor()]),
      factor({ status: 'pending', config: {} }),
      {
        id: 'c1',
        purpose: 'enroll',
      },
    );
    const options = lib.generateRegistrationOptions.mock.calls[0]![0];
    expect(options).toMatchObject({
      rpName: 'B2B',
      rpID: 'auth.example.com',
      userName: 'a@example.com',
      userDisplayName: 'Alice（Acme）',
      attestationType: 'none',
      excludeCredentials: [{ id: 'cred-1', transports: ['usb'] }],
    });
    expect(options.userID).toHaveLength(32);
    expect(start).toEqual({
      state: { challenge: 'reg-ch', rpId: 'auth.example.com' },
      expiresInSeconds: 300,
      resendAfterSeconds: 0,
      publicData: { options: { challenge: 'reg-ch' } },
    });
  });

  it('登入：以註冊時的 RP ID 與憑證產生 options', async () => {
    lib.generateAuthenticationOptions.mockResolvedValue({ challenge: 'auth-ch' });
    const start = await build({
      rpName: 'B2B',
      rpId: 'auth.example.com',
      userVerification: 'required',
      authenticatorAttachment: 'any',
    }).startChallenge(ctx(), factor(), { id: 'c1', purpose: 'login' });
    expect(lib.generateAuthenticationOptions).toHaveBeenCalledWith(
      expect.objectContaining({
        rpID: 'example.com',
        allowCredentials: [{ id: 'cred-1', transports: ['usb'] }],
        userVerification: 'required',
      }),
    );
    expect(start.state).toEqual({ challenge: 'auth-ch', rpId: 'example.com' });
  });

  it('註冊的驗證通過：公鑰與憑證 id 存進 config', async () => {
    lib.verifyRegistrationResponse.mockResolvedValue({
      verified: true,
      registrationInfo: {
        credential: {
          id: 'new-cred',
          publicKey: new Uint8Array([1, 2, 3]),
          counter: 0,
          transports: ['internal'],
        },
        credentialDeviceType: 'multiDevice',
        credentialBackedUp: true,
        aaguid: 'aa',
      },
    });
    const result = await build().verify(
      ctx(),
      factor({ status: 'pending', config: {} }),
      challenge('enroll'),
      {
        response: { id: 'new-cred', rawId: 'new-cred', type: 'public-key', response: {} },
      },
    );
    expect(lib.verifyRegistrationResponse).toHaveBeenCalledWith(
      expect.objectContaining({
        expectedChallenge: 'ch',
        expectedOrigin: 'https://auth.example.com',
        expectedRPID: 'auth.example.com',
      }),
    );
    expect(result).toEqual({
      ok: true,
      factorUpdate: {
        config: {
          credentialId: 'new-cred',
          publicKey: Buffer.from([1, 2, 3]).toString('base64url'),
          rpId: 'auth.example.com',
          transports: ['internal'],
          deviceType: 'multiDevice',
          backedUp: true,
          aaguid: 'aa',
        },
      },
    });
  });

  it('函式庫丟例外（回應被竄改）→ invalid', async () => {
    lib.verifyRegistrationResponse.mockRejectedValue(new Error('bad signature'));
    expect(
      await build().verify(ctx(), factor(), challenge('enroll'), {
        response: { id: 'x', rawId: 'x', type: 'public-key', response: {} },
      }),
    ).toEqual({ ok: false, reason: 'invalid' });
  });

  it('登入：回應的憑證不是這個因子的 → invalid，不呼叫函式庫', async () => {
    expect(
      await build().verify(ctx(), factor(), challenge('login'), {
        response: { id: 'other', rawId: 'other', type: 'public-key', response: {} },
      }),
    ).toEqual({ ok: false, reason: 'invalid' });
    expect(lib.verifyAuthenticationResponse).not.toHaveBeenCalled();
  });

  it.each([
    [0, { ok: true }],
    [7, { ok: true, counter: 7 }],
  ])(
    '登入成功：計數 %s（同步型的通行金鑰永遠是 0，不交給框架比較）',
    async (newCounter, expected) => {
      lib.verifyAuthenticationResponse.mockResolvedValue({
        verified: true,
        authenticationInfo: { newCounter },
      });
      expect(
        await build().verify(ctx(), factor({ lastUsedCounter: 3 }), challenge('login'), {
          response: { id: 'cred-1', rawId: 'cred-1', type: 'public-key', response: {} },
        }),
      ).toEqual(expected);
      expect(lib.verifyAuthenticationResponse).toHaveBeenCalledWith(
        expect.objectContaining({
          credential: expect.objectContaining({ id: 'cred-1', counter: 3 }),
        }),
      );
    },
  );

  it('沒有 challenge 或狀態不對 → expired', async () => {
    expect(
      await build().verify(ctx(), factor(), null, {
        response: { id: 'cred-1', rawId: 'x', type: 'public-key', response: {} },
      }),
    ).toEqual({ ok: false, reason: 'expired' });
  });
});
