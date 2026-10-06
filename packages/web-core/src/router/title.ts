declare module '@tanstack/react-router' {
  interface StaticDataRouteOption {
    /**
     * 頁面標題的語系鍵（完整字面量，docs/conventions/06-literal-strings.md）：`document.title` 是「頁面 · 產品名」
     * （web-core/shell 的 `DocumentTitle`）。子路由（對話框即路由）沒有時沿用最近的上層。
     */
    titleKey?: string;
  }
}

/** 由內往外找第一個帶 `titleKey` 的路由（最深的那一層優先）。 */
export function findTitleKey(
  matches: ReadonlyArray<{ staticData?: { titleKey?: string } }>,
): string | undefined {
  for (let index = matches.length - 1; index >= 0; index -= 1) {
    const key = matches[index]?.staticData?.titleKey;
    if (key) return key;
  }
  return undefined;
}
