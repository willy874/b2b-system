import { readFileSync } from 'node:fs';
import { basename, relative } from 'node:path';

import { describe, expect, it } from 'vitest';

import { frontendApps, REPO_ROOT, sourceFiles } from './workspace';

/**
 * 兩個前端之間的複製（docs/architecture/frontend/17-shared-packages.md §2：第二個前端需要時搬進 package，不要複製）。
 * 同名的檔案（不同 app、檔名相同；feature 名稱可以不同，例：`features/auth` ↔ `features/login`），
 * 兩邊都超過 `MIN_LINES` 行、去掉空白後的「行集合」相似度（交集／聯集）超過 `MAX_SIMILARITY`，就當成複製。
 */
const MIN_LINES = 30;
const MAX_SIMILARITY = 0.7;

/**
 * 已知、刻意留著的相似檔案（各 app 相對 src/ 的路徑，依字母排序後以 ` ↔ ` 連接）與理由。
 * 新增一列前先問：差異能不能改成參數放進 web-core（17 §2 第 2 題）？
 */
const KNOWN_SIMILAR: Readonly<Record<string, string>> = {
  'apps/backstage/src/app/layouts/headerTools.ts ↔ apps/platform/src/app/layouts/headerTools.ts':
    '各 app 登記自己的頂列工具（backstage 多了批次佇列）；登記機制在 web-core/toolbar',
  'apps/backstage/src/app/plugin.ts ↔ apps/platform/src/app/plugin.ts':
    'createRouter 的設定：route tree、預設的載入中與錯誤頁、module augmentation 都屬於 app',
  'apps/backstage/src/features/account/pages/Preference/page.tsx ↔ apps/platform/src/features/account/pages/Preference/page.tsx':
    '分頁已在 web-core（PreferenceSections）；backstage 同步到帳號、apps/platform 只存在瀏覽器',
  'apps/backstage/src/features/audit-log/plugin.ts ↔ apps/platform/src/features/audit-log/plugin.ts':
    'plugin 的樣板（登記頁面權限、選單入口、偏好與語系包）；登記的內容是各 app 自己的頁面與路徑',
  'apps/backstage/src/features/auth/pages/Login/page.tsx ↔ apps/platform/src/features/login/pages/Login/page.tsx':
    '只差語系鍵與登入頁的路徑；可比照 sessionEndMessageKey 把流程搬進 web-core（待做）',
  'apps/backstage/src/features/auth/pages/SsoCallback/page.tsx ↔ apps/platform/src/features/login/pages/SsoCallback/page.tsx':
    '只差語系鍵；可比照 sessionEndMessageKey 把流程搬進 web-core（待做）',
  'apps/backstage/src/features/job/pages/JobList/page.tsx ↔ apps/platform/src/features/job/pages/JobList/page.tsx':
    '標題列、佇列概況、表格、展開狀態都在 web-core/job；剩下的是各 app 的端點、adapter 與 apps/platform 的租戶欄',
  'apps/backstage/src/features/notification/components/NotificationBell.tsx ↔ apps/platform/src/features/notification/components/NotificationBell.tsx':
    '打不同的端點（/notifications、/platform/notifications），未讀數與列表的 hook 各自一份',
};

/** 去掉前後空白的非空行。 */
function linesOf(file: string): string[] {
  return readFileSync(file, 'utf8')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
}

function similarity(a: Set<string>, b: Set<string>): number {
  const shared = [...a].filter((line) => b.has(line)).length;
  return shared / (a.size + b.size - shared);
}

interface Candidate {
  path: string;
  lines: Set<string>;
}

/** 正式程式碼（不含測試與 test/）。 */
function candidates(srcDir: string): Candidate[] {
  return sourceFiles(srcDir, /\.(tsx?|css)$/)
    .filter((file) => !/(__tests__|\/test\/)|\.(test|spec|stories)\./.test(file))
    .map((file) => ({ path: relative(REPO_ROOT, file), lines: linesOf(file) }))
    .filter(({ lines }) => lines.length > MIN_LINES)
    .map(({ path, lines }) => ({ path, lines: new Set(lines) }));
}

describe('兩個前端之間的複製（docs/architecture/frontend/17-shared-packages.md §2、§5）', () => {
  const apps = frontendApps();
  const [first, ...others] = apps.map((app) => candidates(app.srcDir));

  it('掃得到兩個以上的前端（測試本身有效）', () => {
    expect(apps.length).toBeGreaterThanOrEqual(2);
  });

  const pairs = (first ?? []).flatMap((a) =>
    others
      .flat()
      .flatMap((b) =>
        basename(a.path) === basename(b.path)
          ? [{ key: [a.path, b.path].toSorted().join(' ↔ '), score: similarity(a.lines, b.lines) }]
          : [],
      ),
  );
  const similar = pairs.filter(({ score }) => score > MAX_SIMILARITY);

  it(`同名檔案的行集合相似度不超過 ${MAX_SIMILARITY}（除了 KNOWN_SIMILAR）`, () => {
    const offenders = similar
      .filter(({ key }) => !(key in KNOWN_SIMILAR))
      .map(({ key, score }) => `${score.toFixed(2)} ${key}`);
    expect(offenders, offenders.join('\n')).toEqual([]);
  });

  it('KNOWN_SIMILAR 沒有過期的列（已經不像、或檔案已搬走就刪掉）', () => {
    const current = new Set(similar.map(({ key }) => key));
    const stale = Object.keys(KNOWN_SIMILAR).filter((key) => !current.has(key));
    expect(stale, stale.join('\n')).toEqual([]);
  });
});
