/**
 * 以語系的寫法串接清單：中文「A、B和C」、英文「A, B, and C」（`Intl.ListFormat`）。
 * 不要寫死 `join('、')`：英文介面會出現「VIP、Partner」（docs/architecture/frontend/08-i18n.md §5）。
 * 語系不合法時退回瀏覽器的預設語系。
 */
export function formatList(
  items: readonly string[],
  locale: string,
  options: Intl.ListFormatOptions = { type: 'conjunction' },
): string {
  try {
    return new Intl.ListFormat(locale, options).format(items);
  } catch {
    // RangeError：不合法的語系標籤
    return new Intl.ListFormat(undefined, options).format(items);
  }
}
