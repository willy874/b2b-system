import { Icon } from '../Icon';
import type { IconName } from '../Icon';
import type { TreeEditorTextLabels } from '../labels';
import type { ToolbarItem } from '../Toolbar';
import type { TreeEditorLayout } from './treeEditorTypes';

/** 工具列的一顆按鈕；`key` 同時是 `data-value`（`tree-editor-action` ＋ `data-value`）。 */
function toolbarAction(
  key: string,
  label: string,
  icon: IconName,
  onClick: () => void,
  options: Pick<ToolbarItem, 'disabled' | 'align'> = {},
): ToolbarItem {
  return {
    key,
    label,
    icon: <Icon name={icon} size={16} />,
    onClick,
    'data-testid': 'tree-editor-action',
    ...options,
  };
}

export interface TreeEditorToolbarOptions {
  labels: TreeEditorTextLabels;
  editable: boolean;
  /** 有 `createNode` 才能新增 */
  canCreate: boolean;
  layout: TreeEditorLayout;
  /** 選取的節點（新增子節點要剛好一個） */
  selectedIds: readonly string[];
  hasSelection: boolean;
  isEmpty: boolean;
  canUndo: boolean;
  canRedo: boolean;
  onAddRoot: () => void;
  onAddChild: (parentId: string) => void;
  onDelete: () => void;
  onAutoLayout: () => void;
  onUndo: () => void;
  onRedo: () => void;
  onZoomOut: () => void;
  onZoomIn: () => void;
  onFitView: () => void;
}

/** 工具列：編輯動作在前，檢視操作靠右；放不下時從尾端（檢視操作）收進「更多」下拉。 */
export function treeEditorToolbarItems({
  labels,
  editable,
  canCreate,
  layout,
  selectedIds,
  hasSelection,
  isEmpty,
  canUndo,
  canRedo,
  onAddRoot,
  onAddChild,
  onDelete,
  onAutoLayout,
  onUndo,
  onRedo,
  onZoomOut,
  onZoomIn,
  onFitView,
}: TreeEditorToolbarOptions): ToolbarItem[] {
  return [
    ...(editable && canCreate
      ? [
          toolbarAction('add-root', labels.addRoot, 'plus', onAddRoot),
          toolbarAction(
            'add-child',
            labels.addChild,
            'folder-plus',
            () => {
              const [parentId] = selectedIds;
              if (parentId !== undefined) onAddChild(parentId);
            },
            { disabled: selectedIds.length !== 1 },
          ),
        ]
      : []),
    ...(editable
      ? [
          toolbarAction('delete', labels.deleteSelection, 'trash', onDelete, {
            disabled: !hasSelection,
          }),
        ]
      : []),
    ...(editable && layout === 'manual'
      ? [
          toolbarAction('auto-layout', labels.autoLayout, 'network', onAutoLayout, {
            disabled: isEmpty,
          }),
        ]
      : []),
    ...(editable
      ? [
          toolbarAction('undo', labels.undo, 'undo', onUndo, { disabled: !canUndo, align: 'end' }),
          toolbarAction('redo', labels.redo, 'redo', onRedo, { disabled: !canRedo, align: 'end' }),
        ]
      : []),
    toolbarAction('zoom-out', labels.zoomOut, 'zoom-out', onZoomOut, { align: 'end' }),
    toolbarAction('zoom-in', labels.zoomIn, 'zoom-in', onZoomIn, { align: 'end' }),
    toolbarAction('fit-view', labels.fitView, 'maximize', onFitView, { align: 'end' }),
  ];
}
