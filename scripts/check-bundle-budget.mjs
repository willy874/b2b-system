// 前端 bundle 預算（docs/architecture/frontend/19-observability.md §7）：
//   BUILD_MANIFEST=true pnpm --filter @b2b-system/backstage build
//   node scripts/check-bundle-budget.mjs apps/backstage [apps/platform …]
//
// 每個 app 的 `bundle-budget.json`：
//   initialKb   首頁初始載入的 JS（entry 沿靜態 import 走到的所有 chunk，不含動態 import）的 gzip 總和
//   maxChunkKb  任何一個 JS chunk（含 lazy 與 worker）的 gzip 上限
// 超過就以非 0 結束；在 GitHub Actions 裡另外把表格寫進 job summary。
// 調高預算要改 bundle-budget.json，review 看得到（設計決策 D12）。
import { appendFileSync, existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { gzipSync } from 'node:zlib';

const ROOT = resolve(import.meta.dirname, '..');
const KB = 1024;

const gzipKb = (file) => gzipSync(readFileSync(file), { level: 9 }).length / KB;
const format = (kb) => `${kb.toFixed(1)} KB`;

function listJs(dir) {
  return readdirSync(dir, { recursive: true })
    .filter((name) => name.endsWith('.js'))
    .map((name) => join(dir, name));
}

/** entry 沿 `imports`（靜態）走到的所有 chunk；`dynamicImports` 是 lazy 載入，不算初始。 */
function initialChunks(manifest) {
  const seen = new Set();
  const visit = (key) => {
    if (seen.has(key)) return;
    seen.add(key);
    for (const next of manifest[key]?.imports ?? []) visit(next);
  };
  for (const [key, chunk] of Object.entries(manifest)) if (chunk.isEntry) visit(key);
  return [...seen].map((key) => manifest[key]?.file).filter((file) => file?.endsWith('.js'));
}

function check(appDir) {
  const dir = resolve(ROOT, appDir);
  const dist = join(dir, 'dist');
  const manifestFile = join(dist, '.vite', 'manifest.json');
  const budgetFile = join(dir, 'bundle-budget.json');
  if (!existsSync(manifestFile)) {
    throw new Error(
      `${appDir}：找不到 ${relative(ROOT, manifestFile)}，請先以 BUILD_MANIFEST=true 建置`,
    );
  }
  if (!existsSync(budgetFile)) throw new Error(`${appDir}：缺少 bundle-budget.json`);
  const manifest = JSON.parse(readFileSync(manifestFile, 'utf8'));
  const budget = JSON.parse(readFileSync(budgetFile, 'utf8'));

  const initialKb = initialChunks(manifest).reduce(
    (sum, file) => sum + gzipKb(join(dist, file)),
    0,
  );
  const chunks = listJs(dist).map((file) => ({ file: relative(dist, file), kb: gzipKb(file) }));
  const largest = chunks.reduce((max, chunk) => (chunk.kb > max.kb ? chunk : max), {
    file: '-',
    kb: 0,
  });

  const rows = [
    { name: '初始載入', actual: initialKb, limit: budget.initialKb, note: '' },
    { name: '最大 chunk', actual: largest.kb, limit: budget.maxChunkKb, note: largest.file },
  ];
  return { appDir, rows, failed: rows.some((row) => row.actual > row.limit) };
}

const apps = process.argv.slice(2);
if (apps.length === 0) {
  process.stderr.write(
    '用法：node scripts/check-bundle-budget.mjs apps/backstage [apps/platform …]\n',
  );
  process.exit(2);
}

const results = apps.map(check);
const lines = [
  '| app | 項目 | 實際（gzip） | 預算 | 結果 | 備註 |',
  '| --- | --- | --- | --- | --- | --- |',
];
for (const { appDir, rows } of results) {
  for (const row of rows) {
    const ok = row.actual <= row.limit;
    lines.push(
      `| ${appDir} | ${row.name} | ${format(row.actual)} | ${format(row.limit)} | ${ok ? '✅' : '❌ 超過'} | ${row.note} |`,
    );
  }
}
const table = `${lines.join('\n')}\n`;
process.stdout.write(table);
if (process.env.GITHUB_STEP_SUMMARY) {
  appendFileSync(process.env.GITHUB_STEP_SUMMARY, `### bundle 預算\n\n${table}`);
}
if (results.some((result) => result.failed)) {
  process.stderr.write(
    'bundle 超過預算：確認是否把大套件打進了首頁（改成動態 import），真的需要時再調高 bundle-budget.json\n',
  );
  process.exit(1);
}
