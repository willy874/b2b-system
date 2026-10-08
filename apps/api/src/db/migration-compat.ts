/**
 * migration 對上一版程式相容的檢查（docs/architecture/01-system.md §7 D14）：滾動部署時新舊兩版程式同時連到新 schema，
 * 破壞性變更要拆成兩次部署（docs/architecture/backend/02-database.md §5.1）。只檢查這次新增的 migration；
 * 確定要破壞時，在那一行上方寫 `-- breaking-ok: <理由與第二次部署的計畫>`。
 */

export interface MigrationProblem {
  file: string;
  /** 1 起算的行號。 */
  line: number;
  rule: string;
  sql: string;
}

interface Rule {
  name: string;
  matches(sql: string): boolean;
}

/** 舊版程式還在讀寫的東西不能消失或改變形狀。 */
const RULES: readonly Rule[] = [
  { name: 'DROP TABLE', matches: (sql) => /\bDROP\s+TABLE\b/i.test(sql) },
  { name: 'DROP COLUMN', matches: (sql) => /\bDROP\s+COLUMN\b/i.test(sql) },
  { name: 'RENAME', matches: (sql) => /\bRENAME\b/i.test(sql) },
  {
    name: 'ALTER COLUMN … TYPE',
    matches: (sql) => /\bALTER\s+COLUMN\b[^;]*\b(SET\s+DATA\s+)?TYPE\b/i.test(sql),
  },
  { name: 'SET NOT NULL', matches: (sql) => /\bSET\s+NOT\s+NULL\b/i.test(sql) },
  {
    // 舊版程式的 INSERT 不知道這一欄：沒有預設值就寫不進去
    name: 'ADD COLUMN … NOT NULL（沒有 DEFAULT）',
    matches: (sql) =>
      /\bADD\s+COLUMN\b/i.test(sql) && /\bNOT\s+NULL\b/i.test(sql) && !/\bDEFAULT\b/i.test(sql),
  },
];

const ALLOW_MARKER = /^--\s*breaking-ok:\s*\S/;

/** 一份 migration 裡的破壞性語句；上一個非空白行是 `-- breaking-ok:` 的略過。 */
export function findBreakingChanges(file: string, content: string): MigrationProblem[] {
  const problems: MigrationProblem[] = [];
  let previous = '';
  content.split('\n').forEach((raw, index) => {
    const line = raw.trim();
    if (!line) return;
    if (!line.startsWith('--')) {
      const sql = line.replace(/--> statement-breakpoint$/, '').trim();
      const rule = RULES.find((candidate) => candidate.matches(sql));
      if (rule && !ALLOW_MARKER.test(previous)) {
        problems.push({ file, line: index + 1, rule: rule.name, sql });
      }
    }
    previous = line;
  });
  return problems;
}
