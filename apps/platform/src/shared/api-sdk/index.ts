/**
 * 整個 app 對 `packages/api-sdk` 的唯一引用點。
 * 換產生器、改套件名、或要對某個型別做本地修補時，只改這一個檔。
 *
 * 只轉出主入口（型別、URL builder、enum；執行期零 zod）。`@b2b-system/api-sdk/schemas` 的 zod schema 與
 * fetch client 前端用不到，轉出它會把所有端點的 schema 帶進首屏（docs/architecture/frontend/17-shared-packages.md §1）。
 */
export * from '@b2b-system/api-sdk';
