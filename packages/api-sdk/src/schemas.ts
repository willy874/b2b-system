// 由 `pnpm sdk:generate` 產生（packages/api-sdk/codegen）。
// `@b2b-system/api-sdk/schemas`：zod schema 與 fetch client（`request()`、每個操作的函式）。
// 前端只用主入口（型別、URL builder、enum）；這個入口會把所有 schema 帶進 bundle。
export * from './generated/schemas';
