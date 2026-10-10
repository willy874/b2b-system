// 前端 bundle 預算（docs/architecture/frontend/19-observability.md §7）：
//   BUILD_MANIFEST=true pnpm --filter @b2b-system/backstage build
//   node scripts/check-bundle-budget.mjs apps/backstage [apps/platform …]
//
// 每個 app 的 `bundle-budget.json`：
//   initialKb   首頁初始載入的 JS（entry 沿靜態 import 走到的所有 chunk，不含動態 import）的 gzip 總和
//   maxChunkKb  任何一個 JS chunk（含 lazy 與 worker）的 gzip 上限
//   forbiddenInitial  （選用）不得出現在首頁初始載入的模組：比對初始 chunk 的 sourcemap 的來源路徑（子字串）。
//                     要以 BUILD_SOURCEMAP=hidden 建置；這是唯一看得到 tree-shaking 之後實際內容的檢查
//                     （docs/architecture/frontend/19-observability.md §7.3）
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

  const initial = initialChunks(manifest);
  const initialKb = initial.reduce((sum, file) => sum + gzipKb(join(dist, file)), 0);
  const chunks = listJs(dist).map((file) => ({ file: relative(dist, file), kb: gzipKb(file) }));
  const largest = chunks.reduce((max, chunk) => (chunk.kb > max.kb ? chunk : max), {
    file: '-',
    kb: 0,
  });

  const rows = [
    {
      name: '初始載入',
      actual: initialKb,
      limit: budget.initialKb,
      note: `${initial.length} 個 chunk，餘 ${format(budget.initialKb - initialKb)}`,
    },
    {
      name: '最大 chunk',
      actual: largest.kb,
      limit: budget.maxChunkKb,
      note: `${largest.file}，餘 ${format(budget.maxChunkKb - largest.kb)}`,
    },
  ];
  const forbidden = forbiddenInInitial(dist, initial, budget.forbiddenInitial ?? []);
  return {
    appDir,
    rows,
    forbidden,
    failed: rows.some((row) => row.actual > row.limit) || forbidden.length > 0,
  };
}

/** 初始 chunk 的 sourcemap 裡，來源路徑含有 `patterns` 任一個的模組（`<pattern> ← <chunk>`）。 */
function forbiddenInInitial(dist, initial, patterns) {
  if (patterns.length === 0) return [];
  // rolldown 的 runtime 等極小的 chunk 沒有 sourcemap；全部都沒有代表不是以 BUILD_SOURCEMAP=hidden 建置
  const mapped = initial.filter((file) => existsSync(join(dist, `${file}.map`)));
  if (mapped.length === 0) {
    throw new Error(
      '初始 chunk 都沒有 sourcemap：forbiddenInitial 要以 BUILD_SOURCEMAP=hidden 建置',
    );
  }
  const hits = new Set();
  for (const file of mapped) {
    const { sources = [] } = JSON.parse(readFileSync(join(dist, `${file}.map`), 'utf8'));
    for (const source of sources) {
      for (const pattern of patterns)
        if (source.includes(pattern)) hits.add(`${pattern} ← ${file}`);
    }
  }
  return [...hits];
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
for (const { appDir, forbidden } of results) {
  for (const hit of forbidden) lines.push(`| ${appDir} | 首頁禁止的模組 | - | - | ❌ | ${hit} |`);
}
const table = `${lines.join('\n')}\n`;
process.stdout.write(table);
if (process.env.GITHUB_STEP_SUMMARY) {
  appendFileSync(process.env.GITHUB_STEP_SUMMARY, `### bundle 預算\n\n${table}`);
}
if (results.some((result) => result.failed)) {
  process.stderr.write(
    'bundle 超過預算，或首頁出現了 forbiddenInitial 列出的模組：確認是否把大套件打進了首頁（改成動態 import），真的需要時再調高 bundle-budget.json\n',
  );
  process.exit(1);
}
