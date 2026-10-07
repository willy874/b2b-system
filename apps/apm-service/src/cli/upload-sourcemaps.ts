/**
 * 把一個前端 `dist/` 裡的 `.map` 上傳到 apm-service（設計決策 D4）。
 *
 *   pnpm --filter @b2b-system/apm-service upload-sourcemaps \
 *     --project backstage --release 1a2b3c4 --dir apps/backstage/dist [--delete]
 *
 * - `--dir` 以執行指令的目錄為基準（pnpm 的 `INIT_CWD`），不是 apps/apm-service。
 * - 位址：`--url`，或環境變數 `APM_UPLOAD_URL`，預設 `http://<APM_HOST>:<APM_PORT>`。
 * - token：環境變數 `APM_AUTH_TOKEN`（與服務同一個；根目錄的 .env 會自動載入）。
 * - `--delete`：上傳成功的 `.map` 從 `dist/` 刪掉，正式映像不帶 sourcemap。
 * - 同名檔案已存在（409）視為已上傳，不算失敗：同一個 release 重跑是安全的。
 */
import { existsSync } from 'node:fs';
import { readdir, readFile, rm } from 'node:fs/promises';
import { join, relative, resolve, sep } from 'node:path';
import { parseArgs } from 'node:util';

const PACKAGE_ROOT = resolve(import.meta.dirname, '../..');
const ROOT_ENV_FILE = resolve(PACKAGE_ROOT, '../../.env');

function fail(message: string): never {
  process.stderr.write(`upload-sourcemaps：${message}\n`);
  process.exit(1);
}

async function findSourcemaps(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { recursive: true });
  return entries.filter((entry) => entry.endsWith('.map')).toSorted();
}

async function main(): Promise<void> {
  if (existsSync(ROOT_ENV_FILE)) process.loadEnvFile(ROOT_ENV_FILE);
  const { values } = parseArgs({
    options: {
      project: { type: 'string' },
      release: { type: 'string' },
      dir: { type: 'string' },
      url: { type: 'string' },
      org: { type: 'string' },
      delete: { type: 'boolean', default: false },
    },
  });
  const project = values.project ?? fail('缺少 --project（例：backstage）');
  const release = values.release ?? fail('缺少 --release（例：git rev-parse --short=7 HEAD）');
  const dirArg = values.dir ?? fail('缺少 --dir（例：apps/backstage/dist）');
  const token = process.env.APM_AUTH_TOKEN ?? fail('缺少環境變數 APM_AUTH_TOKEN');
  const org = values.org ?? process.env.APM_ORG ?? 'b2b-system';
  const baseUrl = (
    values.url ??
    process.env.APM_UPLOAD_URL ??
    `http://${process.env.APM_HOST ?? '127.0.0.1'}:${process.env.APM_PORT ?? '9100'}`
  ).replace(/\/+$/, '');
  const dir = resolve(process.env.INIT_CWD ?? process.cwd(), dirArg);
  if (!existsSync(dir)) fail(`找不到資料夾 ${dir}`);

  const files = await findSourcemaps(dir);
  if (files.length === 0) fail(`${dir} 裡沒有 .map；建置時要設 BUILD_SOURCEMAP=hidden`);

  const endpoint = `${baseUrl}/api/0/projects/${org}/${project}/releases/${encodeURIComponent(release)}/files/`;
  const uploadOne = async (file: string): Promise<'uploaded' | 'skipped'> => {
    const absolute = join(dir, file);
    // Sentry 的慣例：`~/` ＋ 網址上的路徑
    const name = `~/${relative(dir, absolute).split(sep).join('/')}`;
    const form = new FormData();
    form.set('name', name);
    form.set('file', new Blob([await readFile(absolute)], { type: 'application/json' }), name);
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: form,
    });
    if (response.status !== 409 && !response.ok) {
      fail(`${name} 上傳失敗：${response.status} ${await response.text()}`);
    }
    if (values.delete) await rm(absolute);
    return response.status === 409 ? 'skipped' : 'uploaded';
  };

  let uploaded = 0;
  let skipped = 0;
  for (const file of files) {
    // oxlint-disable-next-line no-await-in-loop -- 依序上傳：失敗時停在第一個出錯的檔案；檔案數量是幾十個
    const result = await uploadOne(file);
    if (result === 'uploaded') uploaded += 1;
    else skipped += 1;
  }
  process.stdout.write(
    `upload-sourcemaps：${project}@${release} 上傳 ${uploaded} 個、已存在 ${skipped} 個${values.delete ? '，已從 dist 刪除' : ''}\n`,
  );
}

main().catch((error: unknown) => fail(error instanceof Error ? error.message : String(error)));
