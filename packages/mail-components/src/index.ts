/**
 * api 的郵件範本（`apps/api/src/core/mail/`、各模組的 `*.mail.tsx`）用到的 React Email 元件與 `render`。
 *
 * react-email v6 把元件與預覽伺服器、CLI 放在同一個套件，正式依賴它會把 esbuild、babel、chokidar、prompts… 一起帶進 api 的映像。
 * 這個 package 在建置時以 esbuild 把用到的部分打包成 `dist/index.cjs`（react、react-dom 由 api 提供），
 * react-email 只是 devDependency，`pnpm deploy --prod` 不會安裝它。
 *
 * 範本要用新的元件時加在這裡，再 `pnpm build:packages`。
 */
export {
  Body,
  Button,
  Container,
  Head,
  Hr,
  Html,
  Link,
  Preview,
  render,
  Section,
  Text,
} from 'react-email';
