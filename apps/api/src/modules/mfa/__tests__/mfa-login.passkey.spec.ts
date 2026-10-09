import type { IncomingMessage, ServerResponse } from 'node:http';

import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import type { MfaMethod, MfaRealm } from '@/core/mfa';
import type { PasskeyLogin } from '@/modules/oidc-provider/oidc-provider.service';

import type { MfaStoredAccount } from '../mfa-account.store';
import { MfaLoginService } from '../mfa-login.service';
import type { MfaVerifyOutcome } from '../mfa.service';
import { factor, fakeStore, method, storedAccount, TENANT_ID, USER_ID } from './mfa.fixture';

const req = {} as IncomingMessage;
const res = {} as ServerResponse;
const UID = 'interaction-1';
const PAYLOAD = { response: { id: 'cred-1', userHandle: 'handle-of-user' } };

/** 有 `passwordless` 的方式（WebAuthn 的樣子）；`enabled` 決定平台參數有沒有開。 */
function passkeyMethod(enabled = true): MfaMethod {
  return {
    ...method('webauthn', { challenge: 'server', amr: 'hwk' }),
    verifySchema: z.object({
      response: z.object({ id: z.string(), userHandle: z.string().optional() }),
    }),
    passwordless: {
      enabled: () => enabled,
      begin: vi.fn(async () => ({
        state: { challenge: 'server-challenge', rpId: 'auth.example.com' },
        publicData: { options: { challenge: 'server-challenge' } },
        expiresInSeconds: 300,
      })),
      locate: (payload: unknown) => {
        const { response } = payload as typeof PAYLOAD;
        return {
          configKey: 'credentialId',
          value: response.id,
          accountHandle: response.userHandle ?? null,
        };
      },
      accountHandle: (account: { id: string }) =>
        `handle-of-${account.id === USER_ID ? 'user' : account.id}`,
    },
  };
}

interface SetupOptions {
  realm?: MfaRealm;
  methods?: MfaMethod[];
  pending?: (PasskeyLogin & { expiresAt: Date }) | undefined;
  candidates?: ReturnType<typeof factor>[];
  stored?: MfaStoredAccount | undefined;
  outcome?: MfaVerifyOutcome;
}

function setup(options: SetupOptions = {}) {
  const realm = options.realm ?? 'tenant';
  const webauthn = passkeyMethod();
  const own = fakeStore(realm);
  own.repo.findActiveFactorsByConfig.mockResolvedValue(
    options.candidates ?? [factor({ id: 'factor-wa', method: 'webauthn' })],
  );
  own.store.findAccount.mockResolvedValue(
    'stored' in options ? options.stored : storedAccount(realm),
  );
  const mfa = {
    store: vi.fn(() => own.asStore),
    availableMethods: vi.fn(async () => options.methods ?? [method('totp'), webauthn]),
    verifyFactor: vi.fn(
      async (..._args: unknown[]): Promise<MfaVerifyOutcome> =>
        options.outcome ?? { ok: true, method: webauthn, counter: null },
    ),
  };
  const oidc = {
    savePasskeyLogin: vi.fn(async (..._args: unknown[]) => undefined),
    takePasskeyLogin: vi.fn(async () =>
      'pending' in options
        ? options.pending
        : {
            method: 'webauthn',
            state: { challenge: 'server-challenge', rpId: 'auth.example.com' },
            expiresAt: new Date(Date.now() + 300_000),
          },
    ),
    finishInteraction: vi.fn(async (..._args: unknown[]) => '/resume'),
  };
  const service = new MfaLoginService(
    mfa as never,
    {} as never,
    oidc as never,
    {} as never,
    {} as never,
  );
  return { service, mfa, oidc, own, webauthn };
}

const guardOk = vi.fn(async () => undefined);

describe('MfaLoginService 的通行金鑰登入（docs/architecture/04-sso.md §3.6）', () => {
  describe('passkeyMethod', () => {
    it('可用的方式中 passwordless 開啟的那一個', async () => {
      const ctx = setup();
      await expect(ctx.service.passkeyMethod('tenant')).resolves.toMatchObject({
        definition: { id: 'webauthn' },
      });
    });

    it.each([
      ['平台參數沒開', [passkeyMethod(false)]],
      ['方式不可用（平台關閉或政策不允許）', [method('totp')]],
    ])('%s → null', async (_label, methods) => {
      const ctx = setup({ methods });
      await expect(ctx.service.passkeyMethod('tenant')).resolves.toBeNull();
    });
  });

  describe('startPasskey', () => {
    it('不能用 → AUTH_PASSKEY_UNAVAILABLE，不存狀態', async () => {
      const ctx = setup({ methods: [method('totp')] });
      await expect(ctx.service.startPasskey(UID, 'tenant')).rejects.toMatchObject({
        code: 'AUTH_PASSKEY_UNAVAILABLE',
      });
      expect(ctx.oidc.savePasskeyLogin).not.toHaveBeenCalled();
    });

    it('存下方式與狀態（方式給的有效時間），回傳給瀏覽器的資料', async () => {
      const ctx = setup();
      await expect(ctx.service.startPasskey(UID, 'tenant')).resolves.toEqual({
        options: { challenge: 'server-challenge' },
      });
      expect(ctx.oidc.savePasskeyLogin).toHaveBeenCalledWith(
        UID,
        { method: 'webauthn', state: { challenge: 'server-challenge', rpId: 'auth.example.com' } },
        300,
      );
    });
  });

  describe('verifyPasskey', () => {
    it.each([
      ['沒有 challenge（過期、用過）', { pending: undefined }],
      ['方式已不能用', { methods: [method('totp')] }],
      ['找不到憑證', { candidates: [] }],
      ['帳號已停用', { stored: storedAccount('tenant', { active: false }) }],
    ] as const)('%s → AUTH_PASSKEY_INVALID，不完成互動', async (_label, options) => {
      const ctx = setup(options as SetupOptions);
      await expect(
        ctx.service.verifyPasskey(req, res, UID, 'tenant', PAYLOAD, guardOk),
      ).rejects.toMatchObject({ code: 'AUTH_PASSKEY_INVALID' });
      expect(ctx.oidc.finishInteraction).not.toHaveBeenCalled();
    });

    it('回應沒有 user handle → AUTH_PASSKEY_INVALID，不查因子', async () => {
      const ctx = setup();
      await expect(
        ctx.service.verifyPasskey(req, res, UID, 'tenant', { response: { id: 'cred-1' } }, guardOk),
      ).rejects.toMatchObject({ code: 'AUTH_PASSKEY_INVALID' });
      expect(ctx.own.repo.findActiveFactorsByConfig).not.toHaveBeenCalled();
    });

    it('同一個憑證 id 在兩個帳號：只認 user handle 相符的那一個', async () => {
      const ctx = setup({
        candidates: [
          factor({ id: 'factor-other', method: 'webauthn', accountId: 'other-user' }),
          factor({ id: 'factor-wa', method: 'webauthn', accountId: USER_ID }),
        ],
      });
      const findAccount = ctx.own.store.findAccount as unknown as {
        mockImplementation(fn: (id: string) => Promise<MfaStoredAccount>): void;
      };
      findAccount.mockImplementation(async (id: string) =>
        storedAccount('tenant', {
          account: { ...storedAccount('tenant').account, id },
        }),
      );
      await ctx.service.verifyPasskey(req, res, UID, 'tenant', PAYLOAD, guardOk);
      const [, , chosen] = ctx.mfa.verifyFactor.mock.calls[0]! as [
        unknown,
        unknown,
        { id: string },
      ];
      expect(chosen.id).toBe('factor-wa');
    });

    it('驗證失敗 → 寫失敗稽核、AUTH_PASSKEY_INVALID；不累計鎖定', async () => {
      const ctx = setup({
        outcome: {
          ok: false,
          reason: 'invalid',
          code: 'AUTH_MFA_INVALID_CODE',
        } as MfaVerifyOutcome,
      });
      await expect(
        ctx.service.verifyPasskey(req, res, UID, 'tenant', PAYLOAD, guardOk),
      ).rejects.toMatchObject({ code: 'AUTH_PASSKEY_INVALID' });
      expect(ctx.own.store.audit).toHaveBeenCalledWith(
        expect.objectContaining({
          kind: 'loginFailure',
          errorCode: 'AUTH_PASSKEY_INVALID',
          metadata: expect.objectContaining({ step: 'passkey' }),
        }),
      );
      expect(ctx.own.store.recordLoginFailure).not.toHaveBeenCalled();
    });

    it('guard 拒絕（例：只允許 SSO）→ 原樣拋出，不完成互動', async () => {
      const ctx = setup();
      const guard = vi.fn(async () => {
        throw new Error('sso only');
      });
      await expect(
        ctx.service.verifyPasskey(req, res, UID, 'tenant', PAYLOAD, guard),
      ).rejects.toThrow('sso only');
      expect(ctx.own.store.completeLogin).not.toHaveBeenCalled();
    });

    it('通過 → 把 challenge 存成 login 的 challenge 交給框架驗證，以 [hwk, mfa] 完成登入與互動', async () => {
      const ctx = setup();
      await expect(
        ctx.service.verifyPasskey(req, res, UID, 'tenant', PAYLOAD, guardOk),
      ).resolves.toEqual({ redirectTo: '/resume' });

      expect(ctx.own.repo.findActiveFactorsByConfig).toHaveBeenCalledWith(
        'webauthn',
        'credentialId',
        'cred-1',
        5,
      );
      const inserted = ctx.own.repo.insertChallenge.mock.calls[0]![0];
      expect(inserted).toMatchObject({
        factorId: 'factor-wa',
        purpose: 'login',
        interactionUid: UID,
        state: { challenge: 'server-challenge', rpId: 'auth.example.com' },
      });
      expect(ctx.mfa.verifyFactor).toHaveBeenCalledWith(
        ctx.own.asStore,
        expect.anything(),
        expect.objectContaining({ id: 'factor-wa' }),
        inserted.id,
        PAYLOAD,
        'login',
      );
      expect(ctx.own.store.completeLogin).toHaveBeenCalledWith(expect.anything(), {
        amr: ['hwk', 'mfa'],
        mfaMethod: 'webauthn',
      });
      expect(ctx.oidc.finishInteraction).toHaveBeenCalledWith(req, res, {
        login: { accountId: `t:${TENANT_ID}:${USER_ID}`, amr: ['hwk', 'mfa'] },
      });
    });

    it('鎖定中的帳號也可以（鎖定是擋猜密碼）', async () => {
      const ctx = setup({ stored: storedAccount('tenant', { locked: true }) });
      await expect(
        ctx.service.verifyPasskey(req, res, UID, 'tenant', PAYLOAD, guardOk),
      ).resolves.toEqual({ redirectTo: '/resume' });
    });
  });
});
