/**
 * `className` / `style` / `data-testid` / `aria-label` / `ref` 落在觸發按鈕；
 * 其餘各層用 `classNames` / `styles` / `testIds` 覆寫。
 */
export type SelectSlot =
  | 'value'
  | 'placeholder'
  | 'tag'
  | 'icon'
  | 'positioner'
  | 'popup'
  | 'search'
  | 'searchInput'
  | 'scroller'
  | 'list'
  | 'item'
  | 'expander'
  | 'indicator'
  | 'itemText'
  | 'itemDescription'
  | 'footer';
