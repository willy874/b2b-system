import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { parseArgs } from 'node:util';

import { GENERATED_HEADER, generate } from './generate';

/**
 * 用法：tsx codegen/cli.ts --input <openapi.json> --output <dir>
 * 輸出目錄整個由產生器擁有：每次都先清空（只清得掉帶產生器標頭的檔案，避免誤刪手寫程式碼）。
 */
function main(): void {
  const { values } = parseArgs({
    options: {
      input: { type: 'string', short: 'i' },
      output: { type: 'string', short: 'o' },
    },
  });
  if (!values.input || !values.output) {
    throw new Error('用法：tsx codegen/cli.ts --input <openapi.json> --output <dir>');
  }

  const input = resolve(values.input);
  const output = resolve(values.output);
  if (!input.endsWith('.json')) {
    throw new Error(`目前只支援 JSON 格式的 spec：${input}`);
  }

  const document: unknown = JSON.parse(readFileSync(input, 'utf8'));
  const runtimeSource = readFileSync(new URL('./runtime.ts', import.meta.url), 'utf8');
  const urlSource = readFileSync(new URL('./url.ts', import.meta.url), 'utf8');
  const { files, warnings } = generate(document, { runtimeSource, urlSource });

  cleanOutput(output);
  for (const file of files) {
    const target = join(output, file.path);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, file.content);
  }

  // CLI 的輸出就是給人看的，這裡不走 logger
  // oxlint-disable-next-line no-console
  for (const warning of warnings) console.warn(`⚠ ${warning}`);
  // oxlint-disable-next-line no-console
  console.info(`已產生 ${files.length} 個檔案到 ${relative(process.cwd(), output) || '.'}`);
}

function cleanOutput(output: string): void {
  if (!existsSync(output)) return;
  const foreign = listFiles(output).filter(
    (file) => !readFileSync(file, 'utf8').startsWith(GENERATED_HEADER),
  );
  if (foreign.length) {
    throw new Error(
      `輸出目錄裡有不是產生器寫的檔案，拒絕清空：\n${foreign.map((file) => `  - ${file}`).join('\n')}`,
    );
  }
  rmSync(output, { recursive: true });
}

function listFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? listFiles(path) : [path];
  });
}

try {
  main();
} catch (error) {
  // oxlint-disable-next-line no-console
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
