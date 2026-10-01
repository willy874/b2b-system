import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { NestFactory } from '@nestjs/core';

import { AppModule } from '../src/app.module';
import { buildOpenApiDocument } from '../src/swagger';

/**
 * 產出兩份文件（都進版控），CI 會重跑這支並檢查 `git diff` 為空（ADR-0007）：
 * - `openapi.json`：內部 api，`packages/api-sdk` 由它產生前端 SDK
 * - `openapi.external.json`：對外 API（`/v1/*`），給整合方（docs/adr/0027-api-tokens-external-api.md D12）
 *
 * 兩個程序註冊的 controller 相同，所以從同一個 app 以路徑分開。
 */
async function main(): Promise<void> {
  const app = await NestFactory.create(AppModule, { logger: false });
  await app.init();
  for (const [surface, file] of [
    ['internal', '../openapi.json'],
    ['external', '../openapi.external.json'],
  ] as const) {
    const document = buildOpenApiDocument(app, surface);
    writeFileSync(resolve(__dirname, file), `${JSON.stringify(document, null, 2)}\n`);
  }
  await app.close();
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
