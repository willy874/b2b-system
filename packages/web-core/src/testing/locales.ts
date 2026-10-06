/**
 * 語系檔的檢查（各 app 與 web-core 的 `locales.test.ts`／`resources.test.ts` 共用）。
 * 複數用 i18next 的 `_one`／`_other` 後綴（docs/architecture/frontend/08-i18n.md §5）：
 * 英文要有 `_one` 與 `_other`，中文的複數規則只有 `other`，只放 `_other`。
 */

const PLURAL_SUFFIX = /_(zero|one|two|few|many|other)$/;

/** 巢狀的語系物件攤平成「完整鍵 → 字串」。 */
export function flattenLocale(bundle: unknown, prefix = ''): Record<string, string> {
  if (typeof bundle !== 'object' || bundle === null) return { [prefix]: String(bundle) };
  return Object.fromEntries(
    Object.entries(bundle).flatMap(([key, child]) =>
      Object.entries(flattenLocale(child, prefix ? `${prefix}.${key}` : key)),
    ),
  );
}

/** 鍵集合；複數形的後綴收成同一個鍵（中文只有 `_other`、英文有 `_one`／`_other`，仍是同一個鍵）。 */
export function localeKeySet(bundle: unknown): Set<string> {
  return new Set(Object.keys(flattenLocale(bundle)).map((key) => key.replace(PLURAL_SUFFIX, '')));
}

/**
 * 帶數量的句子是否都有複數形，回傳問題清單（空陣列表示沒問題）：
 * - 英文含 `{{count}}` 的鍵必須是 `_one`／`_other` 成對（不然會出現「Delete 1 users?」）；
 * - 中文要有對應的 `_other`（有 `count` 時 i18next 只找 `_other`）。
 */
export function pluralProblems(en: unknown, zh: unknown): string[] {
  const enKeys = flattenLocale(en);
  const zhKeys = flattenLocale(zh);
  const problems: string[] = [];
  for (const [key, value] of Object.entries(enKeys)) {
    if (!value.includes('{{count}}')) continue;
    const base = key.replace(PLURAL_SUFFIX, '');
    if (base === key) problems.push(`${key}：含 {{count}} 但沒有 _one／_other`);
    else if (!(`${base}_one` in enKeys) || !(`${base}_other` in enKeys)) {
      problems.push(`${base}：英文缺 _one 或 _other`);
    } else if (!(`${base}_other` in zhKeys)) problems.push(`${base}：中文缺 _other`);
  }
  return [...new Set(problems)];
}

/** 鍵（或它的複數形）有翻譯。 */
export function hasLocaleKey(bundle: unknown, key: string): boolean {
  const keys = flattenLocale(bundle);
  return Boolean(keys[key] ?? keys[`${key}_other`]);
}

/** 中文標點：寫在程式裡的話，英文介面會出現「VIP、Partner」「Error code：」「Alice（Oct 6）」。 */
const FULL_WIDTH_PUNCTUATION = /[、（）：｜]/;

/** 把註解換成同樣行數的空白（行號不變）；字串裡的 `//`（網址）前面不是空白，不會被當成註解。 */
function stripComments(source: string): string {
  return source
    .replaceAll(/\/\*[\s\S]*?\*\//g, (comment) => comment.replaceAll(/[^\n]/g, ''))
    .split('\n')
    .map((line) => line.replace(/(^|\s)\/\/.*$/, '$1'))
    .join('\n');
}

/**
 * 程式碼（不含註解）裡寫死的中文標點，回傳 `檔案:行號`（docs/architecture/frontend/08-i18n.md §6）。
 * 清單用 `formatList()`、「名稱（說明）」「欄位：值」用語系鍵（`common.withNote`、`common.labelValue`…）。
 * 給開發者看的錯誤訊息（`throw new Error('…：…')`）不在畫面上，略過。
 */
export function findFullWidthPunctuation(sources: Record<string, string>): string[] {
  return Object.entries(sources).flatMap(([file, source]) =>
    stripComments(source)
      .split('\n')
      .flatMap((line, index) =>
        FULL_WIDTH_PUNCTUATION.test(line) && !/throw new|Error\(/.test(line)
          ? [`${file}:${index + 1}`]
          : [],
      ),
  );
}
