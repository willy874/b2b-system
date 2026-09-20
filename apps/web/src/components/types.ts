import type { Ref } from 'react';

/**
 * 每個元件都必須支援的透傳（docs/frontend/07-ui-system.md §3.1 規則 2、5）。
 * React 19 把 `ref` 當成一般 prop，元件只要把 `...rest` 攤到根元素上即可。
 */
export interface BaseComponentProps<TElement extends HTMLElement = HTMLElement> {
  className?: string;
  ref?: Ref<TElement>;
  'data-testid'?: string;
}
