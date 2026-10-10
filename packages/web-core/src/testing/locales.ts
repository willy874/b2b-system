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

/** 程式碼裡的字串字面量（`'…'`、`"…"`、不含 `${` 的 `` `…` ``）；語系鍵只由字母、數字、`.`、`_`、`-` 組成。 */
const KEY_LITERAL = /(['"`])([\w.-]+)\1/g;

export interface UnusedLocaleKeyOptions {
  /** 要檢查的語系包（同一份程式碼引用的所有包，例：app 與各 feature 的 `zh_TW.json`）。 */
  bundles: readonly unknown[];
  /** 「檔案 → 原始碼」：正式程式碼（不含測試與 story），註解不算引用。 */
  sources: Record<string, string>;
  /**
   * 以樣板字串或後端資料動態組出來的鍵的前綴（例：`permission.`，由權限目錄的 `nameI18nKey` 組成）。
   * 每一項都要在呼叫端註明組 key 的位置（docs/architecture/frontend/08-i18n.md §4.1）。
   */
  dynamicPrefixes?: readonly string[];
}

/**
 * 定義了但程式碼裡沒有任何字面量引用的語系鍵（docs/architecture/frontend/08-i18n.md §4.1）。
 * 複數形（`_one`／`_other`）收成同一個鍵；鍵要寫完整的字面量（docs/coding-standards/06-literal-strings.md），
 * 所以「沒有字面量」就是沒有人用。
 */
export function findUnusedLocaleKeys({
  bundles,
  sources,
  dynamicPrefixes = [],
}: UnusedLocaleKeyOptions): string[] {
  const referenced = new Set<string>();
  for (const source of Object.values(sources)) {
    for (const [, , literal] of stripComments(source).matchAll(KEY_LITERAL)) {
      if (literal) referenced.add(literal);
    }
  }
  const keys = new Set(bundles.flatMap((bundle) => [...localeKeySet(bundle)]));
  return [...keys]
    .filter(
      (key) => !referenced.has(key) && !dynamicPrefixes.some((prefix) => key.startsWith(prefix)),
    )
    .toSorted();
}
