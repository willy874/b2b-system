import type { Browser } from '@playwright/test';

/**
 * 從瀏覽器對某個網域的 api 發請求：`*.localhost` 只有瀏覽器會解析到本機（Node 的 request 解析不到）。
 * 先開那個網域的一個 api 網址，同源的 fetch 才不必處理 CORS。
 */
export async function fetchOn(
  browser: Browser,
  origin: string,
  path: string,
  init: { method?: string; body?: string } = {},
): Promise<{ status: number; code?: string }> {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(`${origin}/api/health`);
  const result = await page.evaluate(
    async ({ url, options }) => {
      const response = await fetch(url, {
        method: options.method ?? 'GET',
        headers: options.body ? { 'content-type': 'application/json' } : undefined,
        body: options.body,
      });
      const body = (await response.json().catch(() => ({}))) as { error?: { code?: string } };
      return { status: response.status, code: body.error?.code };
    },
    { url: `/api${path}`, options: init },
  );
  await context.close();
  return result;
}
