import { readdirSync, statSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

/** orval 的 `clean: true` 會清掉整個資料夾，所以 barrel 由這支腳本重新產生。 */
const generatedDir = resolve(import.meta.dirname, '../src/generated');

const entries = readdirSync(generatedDir)
  .filter((name) => statSync(resolve(generatedDir, name)).isDirectory())
  .sort();

const lines = [
  '// 由 `pnpm sdk:generate` 產生，請勿手動編輯。',
  "export * from './model';",
  ...entries.filter((name) => name !== 'model').map((name) => `export * from './${name}/${name}';`),
];

writeFileSync(resolve(generatedDir, 'index.ts'), `${lines.join('\n')}\n`);
console.info(`已寫入 src/generated/index.ts（${entries.length} 個群組）`);
