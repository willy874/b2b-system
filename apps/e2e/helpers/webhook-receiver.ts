import { createHmac } from 'node:crypto';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';

import { expect } from '@playwright/test';

export interface ReceivedWebhook {
  headers: Record<string, string | string[] | undefined>;
  body: string;
  envelope: { id: string; type: string; tenant: string; data: Record<string, unknown> };
}

export interface WebhookReceiver {
  url: string;
  received: ReceivedWebhook[];
  /** 之後的請求回這個狀態碼（預設 204）；用來模擬接收端故障。 */
  respondWith(status: number): void;
  /** 等到收到 `type` 的事件（真實事件經背景工作投遞，要輪詢），回傳最早的一筆。 */
  waitFor(type: string, match?: (hook: ReceivedWebhook) => boolean): Promise<ReceivedWebhook>;
  close(): Promise<void>;
}

/**
 * 測試程序內的 webhook 接收端（127.0.0.1、隨機埠）。非 production 的 api 允許投遞到本機位址
 * （docs/architecture/backend/17-webhook.md §9.2 D15）。
 * 租戶預設只能有 1 個不重複的目標網址（`webhook.maxUrls`），同一個 spec 的訂閱共用這一個網址。
 */
export async function startWebhookReceiver(): Promise<WebhookReceiver> {
  const received: ReceivedWebhook[] = [];
  let status = 204;
  const server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on('data', (chunk: Buffer) => chunks.push(chunk));
    request.on('end', () => {
      const body = Buffer.concat(chunks).toString('utf8');
      received.push({
        headers: request.headers,
        body,
        envelope: JSON.parse(body) as ReceivedWebhook['envelope'],
      });
      response.writeHead(status).end();
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;

  return {
    url: `http://127.0.0.1:${port}/hooks`,
    received,
    respondWith(next) {
      status = next;
    },
    async waitFor(type, match = () => true) {
      const find = () => received.find((hook) => hook.envelope.type === type && match(hook));
      await expect
        .poll(() => find() !== undefined, { timeout: 20_000, message: `等待 ${type} 的 webhook` })
        .toBe(true);
      return find()!;
    },
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

/** 依 `X-Webhook-Signature` 的規則（D11）以密鑰重算簽章。 */
export function expectedSignature(secret: string, hook: ReceivedWebhook): string {
  const timestamp = String(hook.headers['x-webhook-timestamp']);
  const digest = createHmac('sha256', secret).update(`${timestamp}.${hook.body}`).digest('hex');
  return `sha256=${digest}`;
}
