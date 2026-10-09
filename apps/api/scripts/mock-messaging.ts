/**
 * 模擬的簡訊與通訊軟體服務（docs/architecture/backend/21-mfa.md §13）：開發與 E2E 用，不必申請 Twilio、Telegram、LINE 的帳號。
 * api 以 `MFA_TWILIO_API_URL`／`MFA_TELEGRAM_API_URL`／`MFA_LINE_API_URL` 指向這裡；自訂簡訊閘道的網址填 `<這裡>/sms-gateway`。
 *
 * - Twilio：`GET /2010-04-01/Accounts/:sid.json`（驗證金鑰）、`POST …/Messages.json`（送出）
 * - 自訂閘道：`POST /sms-gateway`（驗證 `X-B2B-Signature`）
 * - Telegram：`POST /bot<token>/getMe｜setWebhook｜sendMessage`
 * - LINE：`GET /v2/bot/info`、`PUT /v2/bot/channel/webhook/endpoint`、`POST /v2/bot/message/push｜reply`、`GET /v2/bot/profile/:id`
 * - 測試輔助：`GET /_mock/messages?to=`（送出的訊息，新的在前）、`DELETE /_mock/messages`、
 *   `POST /_mock/telegram/start { code, chatId, username? }`、`POST /_mock/line/message { userId, text }`（模擬使用者傳訊給 Bot，
 *   會呼叫 api 登記的 webhook）、`GET /_mock/health`
 *
 * 啟動：`pnpm dev:mock-messaging`（:4466）。金鑰以環境變數設定，預設值見下方（平台參數頁填同樣的值）。
 */
import { createHmac, timingSafeEqual } from 'node:crypto';
import { createServer } from 'node:http';
import type { IncomingMessage, Server, ServerResponse } from 'node:http';

const PORT = Number(process.env.MOCK_MESSAGING_PORT ?? 4466);
export const MOCK_TWILIO_SID =
  process.env.MOCK_TWILIO_ACCOUNT_SID ?? 'AC00000000000000000000000000000000';
export const MOCK_TWILIO_TOKEN = process.env.MOCK_TWILIO_AUTH_TOKEN ?? 'mock-twilio-token';
export const MOCK_SMS_GATEWAY_SECRET = process.env.MOCK_SMS_WEBHOOK_SECRET ?? 'mock-sms-secret';
export const MOCK_TELEGRAM_TOKEN =
  process.env.MOCK_TELEGRAM_TOKEN ?? '123456:mock-telegram-token-abcdefghij';
export const MOCK_TELEGRAM_BOT = process.env.MOCK_TELEGRAM_BOT ?? 'b2b_mock_bot';
export const MOCK_LINE_TOKEN = process.env.MOCK_LINE_TOKEN ?? 'mock-line-access-token';
export const MOCK_LINE_SECRET = process.env.MOCK_LINE_CHANNEL_SECRET ?? 'mock-line-channel-secret';
export const MOCK_LINE_BASIC_ID = process.env.MOCK_LINE_BASIC_ID ?? '@mockbot';

export interface SentMessage {
  provider: 'twilio' | 'webhook' | 'telegram' | 'line';
  to: string;
  text: string;
  code: string | null;
  at: string;
}

export const messages: SentMessage[] = [];
let telegramWebhook: { url: string; secret: string } | null = null;
let lineWebhook: string | null = null;

function record(provider: SentMessage['provider'], to: string, text: string, code?: string): void {
  messages.unshift({
    provider,
    to,
    text,
    code: code ?? /\b(\d{6})\b/.exec(text)?.[1] ?? null,
    at: new Date().toISOString(),
  });
  messages.splice(200);
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString('utf8');
}

function send(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

function sameSecret(given: string, expected: string): boolean {
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? '/', 'http://mock');
  const path = url.pathname;
  const method = req.method ?? 'GET';
  const raw = method === 'GET' || method === 'DELETE' ? '' : await readBody(req);
  const json = (): Record<string, unknown> =>
    raw ? (JSON.parse(raw) as Record<string, unknown>) : {};

  // ── 測試輔助 ──
  if (path === '/_mock/health') return send(res, 200, { ok: true });
  if (path === '/_mock/messages' && method === 'GET') {
    const to = url.searchParams.get('to');
    return send(res, 200, { items: to ? messages.filter((m) => m.to === to) : messages });
  }
  if (path === '/_mock/messages' && method === 'DELETE') {
    messages.length = 0;
    return send(res, 200, { ok: true });
  }
  if (path === '/_mock/telegram/start' && method === 'POST') {
    if (!telegramWebhook) return send(res, 409, { error: 'telegram webhook not registered' });
    const body = json();
    const update = {
      update_id: Date.now(),
      message: {
        message_id: 1,
        text: `/start ${String(body.code)}`,
        chat: { id: Number(body.chatId), type: 'private' },
        from: {
          id: Number(body.chatId),
          username: body.username ?? 'mock_user',
          first_name: 'Mock',
        },
      },
    };
    const response = await fetch(telegramWebhook.url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-telegram-bot-api-secret-token': telegramWebhook.secret,
      },
      body: JSON.stringify(update),
    });
    return send(res, 200, { status: response.status });
  }
  if (path === '/_mock/line/message' && method === 'POST') {
    if (!lineWebhook) return send(res, 409, { error: 'line webhook not registered' });
    const body = json();
    const payload = JSON.stringify({
      destination: 'mock',
      events: [
        {
          type: 'message',
          replyToken: `reply-${Date.now()}`,
          source: { type: 'user', userId: String(body.userId) },
          message: { type: 'text', id: '1', text: String(body.text) },
        },
      ],
    });
    const signature = createHmac('sha256', MOCK_LINE_SECRET).update(payload).digest('base64');
    const response = await fetch(lineWebhook, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-line-signature': signature },
      body: payload,
    });
    return send(res, 200, { status: response.status });
  }

  // ── Twilio ──
  const twilio = /^\/2010-04-01\/Accounts\/([^/]+?)(\/Messages)?\.json$/.exec(path);
  if (twilio) {
    const expected = `Basic ${Buffer.from(`${MOCK_TWILIO_SID}:${MOCK_TWILIO_TOKEN}`).toString('base64')}`;
    if (twilio[1] !== MOCK_TWILIO_SID) return send(res, 404, { code: 20404, message: 'not found' });
    if (req.headers.authorization !== expected)
      return send(res, 401, { code: 20003, message: 'auth' });
    if (!twilio[2]) return send(res, 200, { sid: MOCK_TWILIO_SID, status: 'active' });
    const form = new URLSearchParams(raw);
    record('twilio', form.get('To') ?? '', form.get('Body') ?? '');
    return send(res, 201, { sid: `SM${Date.now()}`, status: 'queued' });
  }

  // ── 自訂簡訊閘道 ──
  if (path === '/sms-gateway' && method === 'POST') {
    const timestamp = String(req.headers['x-b2b-timestamp'] ?? '');
    const signature = String(req.headers['x-b2b-signature'] ?? '');
    const expected = `v1=${createHmac('sha256', MOCK_SMS_GATEWAY_SECRET).update(`${timestamp}.${raw}`).digest('hex')}`;
    if (!sameSecret(signature, expected)) return send(res, 401, { error: 'bad signature' });
    const body = json();
    if (body.type === 'mfa.code') {
      record('webhook', String(body.to), String(body.text), String(body.code));
    }
    return send(res, 200, { ok: true });
  }

  // ── Telegram ──
  const telegram = /^\/bot([^/]+)\/(\w+)$/.exec(path);
  if (telegram) {
    if (telegram[1] !== MOCK_TELEGRAM_TOKEN) {
      return send(res, 401, { ok: false, error_code: 401, description: 'Unauthorized' });
    }
    const body = json();
    switch (telegram[2]) {
      case 'getMe':
        return send(res, 200, {
          ok: true,
          result: { id: 123456, is_bot: true, username: MOCK_TELEGRAM_BOT },
        });
      case 'setWebhook':
        telegramWebhook = { url: String(body.url), secret: String(body.secret_token ?? '') };
        return send(res, 200, { ok: true, result: true });
      case 'sendMessage':
        record('telegram', String(body.chat_id), String(body.text));
        return send(res, 200, { ok: true, result: { message_id: Date.now() } });
      default:
        return send(res, 404, { ok: false, description: 'Not Found' });
    }
  }

  // ── LINE ──
  if (path.startsWith('/v2/bot/')) {
    if (req.headers.authorization !== `Bearer ${MOCK_LINE_TOKEN}`) {
      return send(res, 401, { message: 'Authentication failed' });
    }
    if (path === '/v2/bot/info')
      return send(res, 200, { basicId: MOCK_LINE_BASIC_ID, displayName: 'Mock Bot' });
    if (path === '/v2/bot/channel/webhook/endpoint' && method === 'PUT') {
      lineWebhook = String(json().endpoint);
      return send(res, 200, {});
    }
    if (path === '/v2/bot/message/push' || path === '/v2/bot/message/reply') {
      const body = json();
      const text = (body.messages as Array<{ text?: string }> | undefined)?.[0]?.text ?? '';
      record('line', String(body.to ?? body.replyToken), text);
      return send(res, 200, {});
    }
    const profile = /^\/v2\/bot\/profile\/(.+)$/.exec(path);
    if (profile) return send(res, 200, { userId: profile[1], displayName: 'Mock LINE User' });
  }

  send(res, 404, { error: 'not found' });
}

/** 啟動模擬的服務；api 的整合測試以 `port = 0` 起在隨機埠。 */
export function startMockMessaging(port = PORT): Promise<{ url: string; server: Server }> {
  const server = createServer((req, res) => {
    handle(req, res).catch((error: unknown) => send(res, 500, { error: String(error) }));
  });
  return new Promise((resolve) => {
    server.listen(port, '127.0.0.1', () => {
      const { port: actual } = server.address() as { port: number };
      resolve({ url: `http://127.0.0.1:${actual}`, server });
    });
  });
}

if (require.main === module) {
  void startMockMessaging().then(({ url }) => console.log(`模擬的簡訊與通訊軟體服務：${url}`));
}
