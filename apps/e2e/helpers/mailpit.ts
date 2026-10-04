import { expect, request } from '@playwright/test';

/** 本機收信工具（docker-compose.yml 的 mailpit）；api 要以 `pnpm dev:e2e` 啟動才會寄到這裡。 */
const MAILPIT_URL = process.env.E2E_MAILPIT_URL ?? 'http://localhost:8025';

interface MailpitSummary {
  ID: string;
  Subject: string;
}

export interface ReceivedMail {
  subject: string;
  text: string;
}

/**
 * 等到寄給 `to` 的信出現，回傳最新一封。寄信在背景工作裡跑，要輪詢。
 * 每個測試用獨一無二的收件地址，就不必清空信箱、也不會互相干擾。
 * 同一個地址會收到多封信（例：註冊核准同時寄審核結果與啟用信）時，以 `subject` 指定要哪一封。
 */
export async function waitForMail(to: string, subject?: string): Promise<ReceivedMail> {
  const context = await request.newContext({ baseURL: MAILPIT_URL });
  let latest: MailpitSummary | undefined;
  await expect
    .poll(
      async () => {
        const response = await context.get('/api/v1/search', {
          params: { query: `to:"${to}"` },
        });
        const body = (await response.json()) as { messages: MailpitSummary[] };
        const matched = body.messages.filter((m) => subject === undefined || m.Subject === subject);
        latest = matched[0];
        return matched.length;
      },
      {
        timeout: 20_000,
        message: `等待寄給 ${to} 的信${subject === undefined ? '' : `「${subject}」`}`,
      },
    )
    .toBeGreaterThan(0);
  const detail = await context.get(`/api/v1/message/${latest!.ID}`);
  const message = (await detail.json()) as { Subject: string; Text: string };
  await context.dispose();
  return { subject: message.Subject, text: message.Text };
}

/** 信裡指向前端某個路徑的連結 → 只取路徑與查詢字串（給 `page.goto` 用，網域以 baseURL 為準）。 */
export function linkIn(mail: ReceivedMail, path: string): string {
  // 完整網址：帳號流程的連結在 apps/platform（另一個 origin），不能當成 backstage 的相對路徑
  // 查詢字串帶 token 與租戶代碼（docs/architecture/05-tenancy.md §10.2 D26）
  const match = new RegExp(`https?://[^\\s]+${path}\\?[A-Za-z0-9_=&%-]+`).exec(mail.text);
  if (!match) throw new Error(`信裡找不到 ${path} 的連結：\n${mail.text}`);
  return match[0];
}
