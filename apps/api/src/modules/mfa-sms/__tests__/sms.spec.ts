import { createHmac } from 'node:crypto';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { AppException } from '@/core/errors';
import { MfaMethodSettings } from '@/core/mfa';
import type { MfaAccountContext } from '@/core/mfa';

import { SmsGateway } from '../sms-gateway';
import { isAllowedCountry, maskPhone, parseCountryCodes, smsCodeText } from '../sms-text';
import { SmsMfaMethod } from '../sms.method';

const TWILIO = {
  provider: 'twilio',
  twilioAccountSid: `AC${'0'.repeat(32)}`,
  twilioAuthToken: 'token',
  twilioFrom: '+15005550006',
  allowedCountryCodes: '886,852',
};

function gateway(env: Record<string, unknown> = {}) {
  const values: Record<string, unknown> = {
    MFA_TWILIO_API_URL: 'https://twilio.test',
    NODE_ENV: 'test',
    ...env,
  };
  return new SmsGateway({ get: (key: string) => values[key] } as never);
}

function mockFetch(...responses: Array<{ status: number; body?: unknown }>) {
  const fetchMock = vi.fn();
  for (const response of responses) {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify(response.body ?? {}), { status: response.status }),
    );
  }
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

afterEach(() => vi.unstubAllGlobals());

describe('簡訊驗證碼（docs/architecture/backend/21-mfa.md §9.4）', () => {
  describe('工具', () => {
    it('遮蔽號碼、解析國碼、檢查國碼', () => {
      expect(maskPhone('+886912345678')).toBe('+8869*****678');
      expect(parseCountryCodes('886, +852 x 0')).toEqual(['886', '852']);
      expect(isAllowedCountry('+886912345678', ['886'])).toBe(true);
      expect(isAllowedCountry('+15005550006', ['886'])).toBe(false);
    });

    it('簡訊內容依語系，帶上 issuer 與有效時間', () => {
      expect(
        smsCodeText({
          locale: 'zh-TW',
          issuer: 'Acme',
          code: '123456',
          minutes: 10,
          purpose: 'login',
        }),
      ).toBe('【Acme】驗證碼 123456，10 分鐘內有效。請勿提供給任何人。');
      expect(
        smsCodeText({
          locale: 'en-US',
          issuer: 'Acme',
          code: '123456',
          minutes: 10,
          purpose: 'login',
        }),
      ).toContain('Your verification code is 123456');
    });
  });

  describe('SmsGateway', () => {
    it('Twilio：以 Basic auth 送出 To、Body、From', async () => {
      const fetchMock = mockFetch({ status: 201 });
      await gateway().send(TWILIO, {
        to: '+886912345678',
        text: 'hi',
        code: '1',
        locale: 'zh-TW',
        expiresInSeconds: 600,
      });
      const [url, init] = fetchMock.mock.calls[0]!;
      expect(url).toBe(
        `https://twilio.test/2010-04-01/Accounts/${TWILIO.twilioAccountSid}/Messages.json`,
      );
      expect(init.headers.authorization).toBe(
        `Basic ${Buffer.from(`${TWILIO.twilioAccountSid}:token`).toString('base64')}`,
      );
      expect(Object.fromEntries(new URLSearchParams(init.body))).toEqual({
        To: '+886912345678',
        Body: 'hi',
        From: '+15005550006',
      });
    });

    it('Twilio：寄件者是 Messaging Service（MG…）時改帶 MessagingServiceSid；失敗丟錯讓工作重試', async () => {
      const fetchMock = mockFetch({ status: 400 });
      await expect(
        gateway().send(
          { ...TWILIO, twilioFrom: `MG${'1'.repeat(32)}` },
          { to: '+886912345678', text: 'hi', code: '1', locale: 'zh-TW', expiresInSeconds: 600 },
        ),
      ).rejects.toThrow('Twilio 回應 400');
      expect(new URLSearchParams(fetchMock.mock.calls[0]![1].body).get('MessagingServiceSid')).toBe(
        `MG${'1'.repeat(32)}`,
      );
    });

    it.each([
      [401, { ok: false, fields: { twilioAuthToken: 'MFA_SETTING_REJECTED' } }],
      [404, { ok: false, fields: { twilioAccountSid: 'MFA_SETTING_REJECTED' } }],
      [500, { ok: false, reason: 'MFA_PROVIDER_ERROR' }],
      [200, { ok: true }],
    ])('Twilio 的檢查：讀取帳號回 %s', async (status, expected) => {
      mockFetch({ status });
      expect(await gateway().check(TWILIO)).toEqual(expected);
    });

    it('Twilio 的檢查：SID 與寄件者格式不對時不呼叫 API', async () => {
      const fetchMock = mockFetch();
      expect(await gateway().check({ ...TWILIO, twilioAccountSid: 'x', twilioFrom: '!!' })).toEqual(
        {
          ok: false,
          fields: {
            twilioAccountSid: 'MFA_SETTING_INVALID_FORMAT',
            twilioFrom: 'MFA_SETTING_INVALID_FORMAT',
          },
        },
      );
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('自訂閘道：production 只接受 https', async () => {
      expect(
        await gateway({ NODE_ENV: 'production' }).check({
          provider: 'webhook',
          webhookUrl: 'http://sms.example.com',
          webhookSecret: 's',
        }),
      ).toEqual({ ok: false, fields: { webhookUrl: 'MFA_SETTING_INVALID_URL' } });
    });
  });

  describe('自訂閘道的簽章', () => {
    it('X-B2B-Signature = v1=HMAC-SHA256(secret, timestamp.body)', async () => {
      const { createServer } = await import('node:http');
      const received: Array<{ headers: Record<string, unknown>; body: string }> = [];
      const server = createServer((req, res) => {
        let body = '';
        req.on('data', (chunk: Buffer) => (body += chunk.toString()));
        req.on('end', () => {
          received.push({ headers: req.headers, body });
          res.writeHead(200).end('{}');
        });
      });
      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
      const { port } = server.address() as { port: number };
      try {
        await gateway().send(
          {
            provider: 'webhook',
            webhookUrl: `http://127.0.0.1:${port}/sms`,
            webhookSecret: 'secret',
          },
          {
            to: '+886912345678',
            text: 'hi',
            code: '123456',
            locale: 'zh-TW',
            expiresInSeconds: 600,
          },
        );
      } finally {
        server.close();
      }
      const { headers, body } = received[0]!;
      const expected = createHmac('sha256', 'secret')
        .update(`${String(headers['x-b2b-timestamp'])}.${body}`)
        .digest('hex');
      expect(headers['x-b2b-signature']).toBe(`v1=${expected}`);
      expect(JSON.parse(body)).toEqual({
        type: 'mfa.code',
        to: '+886912345678',
        text: 'hi',
        code: '123456',
        locale: 'zh-TW',
        expiresInSeconds: 600,
      });
    });
  });

  describe('SmsMfaMethod', () => {
    function build(values: Record<string, string> | null = TWILIO) {
      const settings = new MfaMethodSettings();
      settings.bind({ get: () => values });
      const registry = { register: vi.fn() };
      const jobs = { register: vi.fn() };
      const gw = {
        send: vi.fn(async () => undefined),
        check: vi.fn(async () => ({ ok: true as const })),
      };
      const method = new SmsMfaMethod(
        registry as never,
        settings,
        {} as never,
        jobs as never,
        gw as never,
      );
      return { method, gw };
    }
    const ctx = { account: { id: 'u1' } } as MfaAccountContext;

    it('需要參數的方式：預設關閉，登記時帶參數定義', () => {
      const { method } = build();
      expect(method.definition.defaultEnabled).toBe(false);
      expect(method.definition.settings?.fields.map((field) => field.key)).toContain(
        'allowedCountryCodes',
      );
    });

    it('號碼在允許的國碼：機密是號碼、config 與前端只拿到遮蔽過的', async () => {
      const { method } = build();
      expect(await method.beginEnrollment(ctx, { phone: '+886912345678' })).toEqual({
        secret: '+886912345678',
        config: { phoneMasked: '+8869*****678' },
        publicData: { phone: '+8869*****678' },
      });
    });

    it('號碼不在允許的國碼 → VALIDATION_FAILED（input.phone）', async () => {
      const { method } = build();
      const error = await method
        .beginEnrollment(ctx, { phone: '+15005550006' })
        .catch((caught: unknown) => caught);
      expect(error).toBeInstanceOf(AppException);
      expect((error as AppException).details).toMatchObject({
        fields: { 'input.phone': 'MFA_PHONE_COUNTRY_NOT_ALLOWED' },
      });
    });

    it('enrollSchema 去掉空白與連字號後要是 E.164', () => {
      const { method } = build();
      expect(method.enrollSchema.parse({ phone: '+886 912-345-678' })).toEqual({
        phone: '+886912345678',
      });
      expect(method.enrollSchema.safeParse({ phone: '0912345678' }).success).toBe(false);
    });

    it('參數檢查：國碼清單不能是空的，其他交給供應商', async () => {
      const { method, gw } = build();
      expect(await method.checkSettings({ ...TWILIO, allowedCountryCodes: 'abc' })).toEqual({
        ok: false,
        fields: { allowedCountryCodes: 'MFA_SETTING_INVALID_FORMAT' },
      });
      expect(await method.checkSettings(TWILIO)).toEqual({ ok: true });
      expect(gw.check).toHaveBeenCalledTimes(1);
    });
  });
});
