import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { NestFactory } from '@nestjs/core';

import { AppModule } from '../src/app.module';
import { buildOpenApiDocument } from '../src/swagger';

/**
 * 產出 `apps/api/openapi.json`（進版控），`packages/api-sdk` 由它產生前端 SDK。
 * CI 會重跑這支並檢查 `git diff` 為空（ADR-0007）。
 */
async function main(): Promise<void> {
  const app = await NestFactory.create(AppModule, { logger: false });
  await app.init();
  const document = buildOpenApiDocument(app);
  writeFileSync(resolve(__dirname, '../openapi.json'), `${JSON.stringify(document, null, 2)}\n`);
  await app.close();
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
