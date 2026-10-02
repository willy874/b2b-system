'use strict';
Object.defineProperty(exports, '__esModule', { value: true });
const node_fs_1 = require('node:fs');
const node_path_1 = require('node:path');
const core_1 = require('@nestjs/core');
const app_module_1 = require('../src/app.module');
const swagger_1 = require('../src/swagger');
/**
 * 產出 `apps/api/openapi.json`（進版控），`packages/api-sdk` 由它產生前端 SDK。
 * CI 會重跑這支並檢查 `git diff` 為空（docs/architecture/backend/03-api-conventions.md §12）。
 */
async function main() {
  const app = await core_1.NestFactory.create(app_module_1.AppModule, { logger: false });
  await app.init();
  const document = (0, swagger_1.buildOpenApiDocument)(app);
  (0, node_fs_1.writeFileSync)(
    (0, node_path_1.resolve)(__dirname, '../openapi.json'),
    `${JSON.stringify(document, null, 2)}\n`,
  );
  await app.close();
}
main().catch((error) => {
  console.error(error);
  process.exit(1);
});
//# sourceMappingURL=generate-openapi.js.map
