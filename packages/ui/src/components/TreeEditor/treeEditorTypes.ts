import type { CSSProperties, ReactNode, Ref } from 'react';

import type { TreeEditorTextLabels } from '../labels';
import type { SlotOverrides } from '../slots';
import type { TreeEditorGroup, TreeEditorNodeSize } from './layout';
import type {
  TreeEditorDirection,
  TreeEditorEdge,
  TreeEditorMode,
  TreeEditorNode,
  TreeEditorValue,
} from './treeGraph';
import type { TreeEditorNodeState, TreeEditorRenderState } from './TreeNode';

/** `className` / `data-testid` 落在最外層；其餘各層用 `classNames` / `styles` / `testIds` 覆寫。 */
export type TreeEditorSlot = 'toolbar' | 'canvas' | 'node' | 'group' | 'minimap' | 'empty';

/**
 * - `manual`：節點可以拖曳，座標存在 `value` 裡（技能樹這類需要擺位置的）。
 * - `auto`：每次結構改變都重新排版，節點不能拖（組織圖、目錄這類只在乎結構的）。
 */
export type TreeEditorLayout = 'manual' | 'auto';

export type TreeEditorEdgeType = 'smoothstep' | 'bezier' | 'straight';

/** 沒有傳的鍵用 `ComponentLabelsContext` 的文案（目前語系）。 */
export type TreeEditorLabels = Partial<TreeEditorTextLabels>;

export interface TreeEditorDeleteRequest {
  nodeIds: string[];
  edgeIds: string[];
}

export interface TreeEditorProps<TData> extends SlotOverrides<TreeEditorSlot> {
  /** 透傳到最外層（React 19 的 ref 是一般 prop）。 */
  ref?: Ref<HTMLDivElement>;
  /** 受控的值；每一次編輯（新增、刪除、連線、拖曳放開、排版、復原）以 `onChange` 回報一整份新值。 */
  value?: TreeEditorValue<TData>;
  defaultValue?: TreeEditorValue<TData>;
  onChange?: (value: TreeEditorValue<TData>) => void;
  /** 預設 `tree`（單一父節點）；技能樹「需要 A 與 B」用 `dag`。 */
  mode?: TreeEditorMode;
  /** 預設 `TB`（根在上）。 */
  direction?: TreeEditorDirection;
  /** 預設 `manual`。 */
  layout?: TreeEditorLayout;
  /** 每個節點的尺寸（px），排版與畫布都用它；預設 180 × 56。 */
  nodeSize?: TreeEditorNodeSize;
  /** 同一層節點之間的距離（px），預設 40。 */
  nodeGap?: number;
  /** 相鄰兩層之間的距離（px），預設 72。 */
  rankGap?: number;
  /** 連線的樣式，預設 `smoothstep`（直角轉折）。 */
  edgeType?: TreeEditorEdgeType;
  /** 節點框內的內容；沒給時顯示 `getNodeLabel` 的文字。 */
  renderNode?: (node: TreeEditorNode<TData>, state: TreeEditorRenderState) => ReactNode;
  /** 節點的名稱（預設內容與報讀器用），預設是 `id`。 */
  getNodeLabel?: (node: TreeEditorNode<TData>) => string;
  /** 節點的外觀狀態（`data-state`）；外框與底色由元件依狀態呈現。 */
  getNodeState?: (node: TreeEditorNode<TData>) => TreeEditorNodeState | undefined;
  /** 強調的節點（`data-highlighted`），例如滑過某個節點時標出它的前置。 */
  highlightedNodeIds?: ReadonlySet<string>;
  /** 已啟用的連線（id 為 `getEdgeId(edge)`），例如技能樹裡兩端都學會的路徑。 */
  activeEdgeIds?: ReadonlySet<string>;
  /** 強調的連線（id 為 `getEdgeId(edge)`），例如滑過某個節點時它的前置路徑。 */
  highlightedEdgeIds?: ReadonlySet<string>;
  /**
   * 在成員節點的範圍外畫出帶標題的分組背景（不可選、不可拖）。
   * 位置由成員節點的座標算出，搭配 `layout="manual"` 自己排好分組時最整齊。
   */
  groups?: readonly TreeEditorGroup[];
  /**
   * 節點與連線能不能被選取、聚焦（預設 true）。結構唯讀、互動放在 `renderNode` 裡的按鈕時設成 false，
   * 就不會多出選取框，Tab 也只停在節點內的按鈕。
   */
  selectable?: boolean;
  /**
   * 建立新節點（不必給 `position`）。沒給時工具列與節點上不出現「新增」。
   * `parentId` 是要接在哪個節點底下；新增根節點時為 `undefined`。
   */
  createNode?: (context: { parentId?: string }) => TreeEditorNode<TData>;
  /** 額外的連線規則（例如限制層數）；自己連自己、重複、循環已經由元件擋下。 */
  isValidConnection?: (edge: TreeEditorEdge, value: TreeEditorValue<TData>) => boolean;
  /** 刪除前確認（例如 `useConfirm()`）；回傳 `false` 取消。刪節點時 `edgeIds` 含它身上的連線。 */
  onBeforeDelete?: (request: TreeEditorDeleteRequest) => boolean | Promise<boolean>;
  /** 選取的節點改變時通知（例如在旁邊的屬性面板編輯它）。 */
  onSelectionChange?: (nodeIds: string[]) => void;
  /** 點一下節點（不論能不能選取）。 */
  onNodeClick?: (node: TreeEditorNode<TData>) => void;
  onNodeDoubleClick?: (node: TreeEditorNode<TData>) => void;
  /** 只能看、平移與縮放，不能改。 */
  readOnly?: boolean;
  /** 右下角的小地圖，預設顯示。 */
  showMinimap?: boolean;
  /** 畫布高度，預設 `32rem`。 */
  height?: CSSProperties['height'];
  /** 沒有傳的文案用 `ComponentLabelsContext`（目前語系），所以 `features/` 不必傳。 */
  labels?: TreeEditorLabels;
  className?: string;
  style?: CSSProperties;
  /** 畫布的名稱。 */
  'aria-label'?: string;
  'data-testid'?: string;
}
