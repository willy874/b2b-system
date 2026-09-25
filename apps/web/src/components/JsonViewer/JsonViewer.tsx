import type { CSSProperties, Ref } from 'react';

import { createSlots } from '../slots';
import type { SlotOverrides } from '../slots';
import { JsonTree } from './JsonTree';
import type { JsonViewerLabels, JsonViewerSlot } from './JsonTree';
import { useJsonTree } from './useJsonTree';

export type { JsonViewerLabels, JsonViewerSlot } from './JsonTree';

export interface JsonViewerProps extends SlotOverrides<JsonViewerSlot> {
  /** 透傳到捲動容器（React 19 的 ref 是一般 prop）。 */
  ref?: Ref<HTMLElement>;
  /** 要顯示的資料；通常是 API 回來的 JSON。 */
  value: unknown;
  /** 超過這個高度就在框內捲動（預設 `20rem`）。 */
  maxHeight?: CSSProperties['maxHeight'];
  /** 這個深度（含）以下的物件／陣列一開始是收合的；根節點深度為 0。預設全部展開。 */
  defaultExpandDepth?: number;
  /** 行數超過這個值才虛擬捲動。預設 100。 */
  virtualThreshold?: number;
  /** 預設文案是繁中；`features/` 使用時以 `t()` 傳入。 */
  labels?: JsonViewerLabels;
  className?: string;
  style?: CSSProperties;
  /** 捲動框的名稱（讓它成為 `region` 地標）。 */
  'aria-label'?: string;
  'data-testid'?: string;
}

export const DEFAULT_JSON_MAX_HEIGHT = '20rem';

/**
 * JSON 預覽：語法上色、物件／陣列可收合、超過 `maxHeight` 在框內捲動；
 * 行數超過門檻時以 `useVirtualRows` 虛擬捲動，只渲染看得到的行，資料再大也不會卡。
 * 換一份 `value` 時收合狀態回到預設。要編輯請用 `JsonEditor`。
 */
export function JsonViewer({
  value,
  maxHeight = DEFAULT_JSON_MAX_HEIGHT,
  defaultExpandDepth = Infinity,
  virtualThreshold,
  labels,
  classNames,
  styles: styleOverrides,
  testIds,
  ...rest
}: JsonViewerProps) {
  const slot = createSlots({ classNames, styles: styleOverrides, testIds });
  const { lines, toggle } = useJsonTree(value, { defaultExpandDepth, resetKey: value });

  return (
    <JsonTree
      lines={lines}
      onToggle={toggle}
      maxHeight={maxHeight}
      virtualThreshold={virtualThreshold}
      labels={labels}
      slot={slot}
      {...rest}
    />
  );
}
