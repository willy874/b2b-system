import { createHmac } from 'node:crypto';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { AppException } from '@/core/errors';
import { MfaMethodSettings } from '@/core/mfa';
import type { MfaAccountContext, MfaChallenge, MfaFactor } from '@/core/mfa';

import { LineChannel } from '../line.channel';
import { LINK_INVALID_REPLY, LINKED_REPLY } from '../messaging-text';
import { LineMfaMethod, TelegramMfaMethod } from '../messaging.method';
import { TelegramChannel } from '../telegram.channel';

const config = {
  get: (key: string) =>
    ({
      MFA_TELEGRAM_API_URL: 'https://telegram.test',
      MFA_LINE_API_URL: 'https://line.test',
      OIDC_ISSUER: 'https://auth.example.com/api/oidc',
    })[key],
} as never;

afterEach(() => vi.unstubAllGlobals());

function factor(overrides: Partial<MfaFactor> = {}): MfaFactor {
  return {
    id: 'f1',
    accountId: 'u1',
    method: 'telegram',
    label: null,
    status: 'pending',
    secretEncrypted: null,
    config: { linkId: 'link-1' },
    lastUsedCounter: null,
    lastUsedAt: null,
    interactionUid: null,
    createdAt: new Date(),
    confirmedAt: null,
    ...overrides,
  };
}

const secrets = {
  encrypt: (plain: string) => `enc:${plain}`,
  decrypt: (sealed: string) => sealed.replace(/^enc:/, ''),
  hmac: (data: string) => createHmac('sha256', 'k').update(data).digest('hex'),
};

function ctx(): MfaAccountContext & { enqueue: ReturnType<typeof vi.fn> } {
  return {
    realm: 'tenant',
    account: {
      id: 'u1',
      email: 'a@example.com',
      displayName: 'A',
      locale: 'zh-TW',
      realm: 'tenant',
      tenant: { id: 't1', code: 'acme', name: 'Acme' },
    },
    secrets,
    enqueue: vi.fn(async () => undefined),
    activeFactors: async () => [],
  };
}

function buildTelegram() {
  const settings = new MfaMethodSettings();
  settings.bind({ get: () => ({ botToken: '1:token', botUsername: 'acme_bot' }) });
  const links = {
    insert: vi.fn(
      async (_values: { codeHash: string; tenantId: string | null; channel: string }) => ({
        id: 'link-1',
        expiresAt: new Date('2026-10-09T01:00:00Z'),
      }),
    ),
    findOwned: vi.fn(),
    link: vi.fn(async () => true),
  };
  const channel = new TelegramChannel(config);
  const reply = vi.spyOn(channel, 'reply').mockResolvedValue(undefined);
  const method = new TelegramMfaMethod(
    channel,
    { register: vi.fn() } as never,
    settings,
    secrets as never,
    {} as never,
    { register: vi.fn() } as never,
    links as never,
    config,
  );
  return { method, links, channel, reply };
}

describe('通訊軟體驗證碼（docs/architecture/backend/21-mfa.md §9.5）', () => {
  describe('TelegramChannel', () => {
    const channel = new TelegramChannel(config);

    it('只接受 /start <綁定碼>（可帶 @bot）', () => {
      expect(channel.normalizeLinkCode('/start abcdefgh1234')).toBe('abcdefgh1234');
      expect(channel.normalizeLinkCode('/start@acme_bot abcdefgh1234')).toBe('abcdefgh1234');
      expect(channel.normalizeLinkCode('hello')).toBeNull();
    });

    it('只處理私訊的文字訊息', () => {
      expect(
        channel.parse({
          message: {
            text: '/start x',
            chat: { id: 42, type: 'private' },
            from: { username: 'alice' },
          },
        }),
      ).toEqual({ recipient: '42', recipientName: '@alice', text: '/start x' });
      expect(channel.parse({ message: { text: 'x', chat: { id: 42, type: 'group' } } })).toBeNull();
    });

    it('連結帶上 Bot 與綁定碼', () => {
      expect(channel.linkInstructions({ botUsername: 'acme_bot' }, 'abc')).toEqual({
        linkUrl: 'https://t.me/acme_bot?start=abc',
        code: '/start abc',
        botName: '@acme_bot',
      });
    });

    it('檢查參數：getMe 取得 username，再把 webhook 指向我們（帶 secret token）', async () => {
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ ok: true, result: { username: 'acme_bot' } })),
        )
        .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true, result: true })));
      vi.stubGlobal('fetch', fetchMock);
      const token = '123:abcdefghijklmnopqrstuvwxyz';
      expect(
        await channel.check(
          { botToken: token },
          'https://auth.example.com/api/mfa-channels/telegram/webhook',
        ),
      ).toEqual({
        ok: true,
        derived: { botUsername: 'acme_bot' },
      });
      expect(fetchMock.mock.calls[1]![0]).toBe(`https://telegram.test/bot${token}/setWebhook`);
      expect(JSON.parse(fetchMock.mock.calls[1]![1].body)).toMatchObject({
        url: 'https://auth.example.com/api/mfa-channels/telegram/webhook',
        secret_token: TelegramChannel.webhookSecretOf(token),
      });
    });

    it('檢查參數：token 被拒 → botToken MFA_SETTING_REJECTED', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: false }))),
      );
      expect(
        await channel.check({ botToken: '123:abcdefghijklmnopqrstuvwxyz' }, 'https://x'),
      ).toEqual({
        ok: false,
        fields: { botToken: 'MFA_SETTING_REJECTED' },
      });
    });
  });

  describe('LineChannel', () => {
    const channel = new LineChannel(config);

    it('簽章：base64(HMAC-SHA256(channel secret, 原始本體))', () => {
      const body = Buffer.from('{"events":[]}');
      const signature = createHmac('sha256', 'secret').update(body).digest('base64');
      expect(LineChannel.verifySignature('secret', body, signature)).toBe(true);
      expect(LineChannel.verifySignature('other', body, signature)).toBe(false);
      expect(LineChannel.verifySignature('secret', body, undefined)).toBe(false);
    });

    it('綁定碼容許小寫、空白、易混淆的字元，取訊息最後的 8 碼', () => {
      const code = channel.newLinkCode();
      expect(code).toMatch(/^[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/);
      expect(channel.normalizeLinkCode('綁定 k7q2 m9xd')).toBe('K7Q2-M9XD');
      expect(channel.normalizeLinkCode('K7Q2-M9XO')).toBe('K7Q2-M9X0');
      expect(channel.normalizeLinkCode('hi')).toBeNull();
    });

    it('只處理一對一聊天的文字訊息', () => {
      expect(
        channel.parse({
          events: [
            {
              type: 'message',
              replyToken: 'r',
              source: { type: 'user', userId: 'U1' },
              message: { type: 'text', text: 'X' },
            },
            {
              type: 'message',
              source: { type: 'group', userId: 'U2' },
              message: { type: 'text', text: 'Y' },
            },
            { type: 'follow', source: { type: 'user', userId: 'U3' } },
          ],
        }),
      ).toEqual([{ recipient: 'U1', recipientName: null, text: 'X', replyToken: 'r' }]);
    });
  });

  describe('MessagingMfaMethod（以 Telegram 為例）', () => {
    it('開始設定：綁定碼只存 HMAC，回傳連結；webhook 網址取自 OIDC issuer', async () => {
      const { method, links } = buildTelegram();
      const start = await method.beginEnrollment(ctx());
      const inserted = links.insert.mock.calls[0]![0];
      expect(inserted).toMatchObject({
        channel: 'telegram',
        realm: 'tenant',
        tenantId: 't1',
        accountId: 'u1',
      });
      const code = String(start.publicData.code).replace('/start ', '');
      expect(inserted.codeHash).toBe(secrets.hmac(`mfa-channel-link:telegram:${code}`));
      expect(start.config).toEqual({ linkId: 'link-1' });
      expect(start.publicData.linkUrl).toBe(`https://t.me/acme_bot?start=${code}`);
    });

    it('還沒綁定就請求驗證碼 → MFA_CHANNEL_NOT_LINKED，不入列', async () => {
      const { method, links } = buildTelegram();
      links.findOwned.mockResolvedValue({
        recipientEncrypted: null,
        expiresAt: new Date(Date.now() + 60_000),
      });
      const context = ctx();
      const error = await method
        .startChallenge(context, factor(), { id: 'c1', purpose: 'enroll' })
        .catch((caught: unknown) => caught);
      expect((error as AppException).code).toBe('MFA_CHANNEL_NOT_LINKED');
      expect(context.enqueue).not.toHaveBeenCalled();
      expect(links.findOwned).toHaveBeenCalledWith('link-1', {
        realm: 'tenant',
        tenantId: 't1',
        accountId: 'u1',
      });
    });

    it('綁定後請求：收件對象放進 challenge、入列送訊息的工作', async () => {
      const { method, links } = buildTelegram();
      links.findOwned.mockResolvedValue({
        recipientEncrypted: 'enc:42',
        recipientName: '@alice',
        expiresAt: new Date(Date.now() + 60_000),
      });
      const context = ctx();
      const start = await method.startChallenge(context, factor(), { id: 'c1', purpose: 'enroll' });
      expect(start.state).toEqual({
        purpose: 'enroll',
        recipient: 'enc:42',
        recipientName: '@alice',
      });
      expect(start.hint).toBe('@alice');
      expect(context.enqueue).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'mfa.telegramCode' }),
        {
          accountId: 'u1',
          challengeId: 'c1',
        },
      );
    });

    it('設定確認：碼正確時把收件對象搬進因子', async () => {
      const { method } = buildTelegram();
      const challenge: MfaChallenge = {
        id: 'c1',
        factorId: 'f1',
        purpose: 'enroll',
        state: {
          recipient: 'enc:42',
          recipientName: '@alice',
          codeHash: secrets.hmac('c1:123456'),
        },
        attempts: 0,
        expiresAt: new Date(Date.now() + 60_000),
        resendAfter: new Date(),
        consumedAt: null,
        createdAt: new Date(),
      };
      expect(await method.verify(ctx(), factor(), challenge, { code: '000000' })).toEqual({
        ok: false,
        reason: 'invalid',
      });
      expect(await method.verify(ctx(), factor(), challenge, { code: '123456' })).toEqual({
        ok: true,
        factorUpdate: { secret: '42', config: { recipientName: '@alice' } },
      });
    });

    it('webhook 收到綁定碼：記下收件對象並回覆；無效的碼回覆失敗；其他訊息不理會', async () => {
      const { method, links, reply } = buildTelegram();
      const settings = { botToken: '1:token' };
      await method.handleInbound(settings, {
        recipient: '42',
        recipientName: '@alice',
        text: '/start abcdefgh1234',
      });
      expect(links.link).toHaveBeenCalledWith(
        'telegram',
        secrets.hmac('mfa-channel-link:telegram:abcdefgh1234'),
        {
          encrypted: 'enc:42',
          name: '@alice',
        },
      );
      expect(reply).toHaveBeenLastCalledWith(settings, expect.anything(), LINKED_REPLY);

      links.link.mockResolvedValue(false);
      await method.handleInbound(settings, {
        recipient: '42',
        recipientName: null,
        text: '/start zzzzzzzzzzzz',
      });
      expect(reply).toHaveBeenLastCalledWith(settings, expect.anything(), LINK_INVALID_REPLY);

      reply.mockClear();
      await method.handleInbound(settings, { recipient: '42', recipientName: null, text: 'hello' });
      expect(reply).not.toHaveBeenCalled();
    });

    it('LINE 也是同一套流程，只是方式 id 與綁定碼不同', () => {
      const settings = new MfaMethodSettings();
      settings.bind({ get: () => null });
      const method = new LineMfaMethod(
        new LineChannel(config),
        { register: vi.fn() } as never,
        settings,
        secrets as never,
        {} as never,
        { register: vi.fn() } as never,
        {} as never,
        config,
      );
      expect(method.definition).toMatchObject({
        id: 'line',
        enrollChallenge: 'onRequest',
        defaultEnabled: false,
      });
      expect(method.currentSettings()).toBeNull();
    });
  });
});
