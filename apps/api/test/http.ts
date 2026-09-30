import type { INestApplication } from '@nestjs/common';
import type { App } from 'supertest/types';

/**
 * 讓 app 先在 `127.0.0.1` 上監聽，再交給 supertest。
 *
 * 不這樣做的話，supertest 每個請求都 `listen(0)`（綁在 `::`），再連到 `127.0.0.1:<port>`。
 * macOS 上 `[::]:<port>` 可以跟別的程序已經綁在 `127.0.0.1:<port>` 的 socket 同時存在，
 * 這時請求會被那個程序接走（VS Code、Docker 的埠轉發…），測試偶發地拿到 401、404 或卡到逾時。
 * 明確綁在 `127.0.0.1` 時，系統只會配一個那裡沒人用的埠。
 */
export async function listenOnLoopback(app: INestApplication): Promise<App> {
  await app.listen(0, '127.0.0.1');
  return app.getHttpServer() as App;
}
