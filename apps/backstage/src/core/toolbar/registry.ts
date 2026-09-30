import type { ComponentType } from 'react';

import type { IconName } from '@/components/Icon';
import type { HeaderToolbarSettings } from '@/core/store';
import { createRegistry } from '@/shared/registry';

/**
 * 頂列（Header）的一個工具，例如語言、主題切換。
 * 使用者可以在偏好頁開關與排序（`HeaderToolbarSettings`）；工具本身不需要知道這件事。
 */
export interface HeaderTool {
  /** 存進偏好設定的鍵，發佈後不要改名（改名等於新工具，使用者的設定會失效）。 */
  key: string;
  /** 沒有調整過時的預設順序，數字小的在左。 */
  order: number;
  /** 偏好頁列出時的名稱；要放在全域語系包，偏好頁之外也看得懂。 */
  labelI18nKey: string;
  /** 偏好頁列出時的圖示。 */
  icon: IconName;
  Component: ComponentType;
}

export interface ResolvedHeaderTool {
  tool: HeaderTool;
  visible: boolean;
}

/** 可訂閱：feature 在執行期安裝或卸載時，頂列跟著更新（docs/adr/0021-runtime-feature-activation.md D4）。 */
export const headerToolRegistry = createRegistry<string, HeaderTool>('Header tool');

/**
 * 在 plugin 的同步階段登記（`app/plugin.ts` 或 feature 的 plugin），頂列第一次渲染前就要存在。
 * 回傳反註冊函式。
 */
export function registerHeaderTool(tool: HeaderTool): () => void {
  return headerToolRegistry.register(tool.key, tool);
}

export function sortHeaderTools(tools: Iterable<HeaderTool>): HeaderTool[] {
  return [...tools].toSorted((a, b) => a.order - b.order);
}

/** 依預設順序列出所有登記過的工具。 */
export function getHeaderTools(): HeaderTool[] {
  return sortHeaderTools(headerToolRegistry.values());
}

/**
 * 把使用者的設定套到登記的工具上：先照設定的順序，設定裡沒有的（新追加的工具）依預設順序接在後面、預設顯示；
 * 設定裡有但已經不存在的工具直接略過。
 */
export function resolveHeaderTools(
  registered: HeaderTool[],
  settings: HeaderToolbarSettings | null,
): ResolvedHeaderTool[] {
  if (!settings) return registered.map((tool) => ({ tool, visible: true }));
  const byKey = new Map(registered.map((tool) => [tool.key, tool]));
  const ordered = settings.order.flatMap((key) => byKey.get(key) ?? []);
  const added = registered.filter((tool) => !settings.order.includes(tool.key));
  return [...ordered, ...added].map((tool) => ({
    tool,
    visible: !settings.hidden.includes(tool.key),
  }));
}

/** 測試用。 */
export function resetHeaderToolRegistry(): void {
  headerToolRegistry.reset();
}
