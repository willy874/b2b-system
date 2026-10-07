import { Icon } from '../Icon';
import type { ToolbarItem } from '../Toolbar';
import type { ResolvedJsonEditorLabels } from './jsonEditorLabels';

export interface JsonEditorToolbarOptions {
  labels: ResolvedJsonEditorLabels;
  readOnly: boolean;
  /** 內容不是合法 JSON：不能格式化或壓縮 */
  hasParseError: boolean;
  canUndo: boolean;
  canRedo: boolean;
  onSearch: () => void;
  onExpandAll: () => void;
  onCollapseAll: () => void;
  onFormat: () => void;
  onCompact: () => void;
  onUndo: () => void;
  onRedo: () => void;
}

/** 工具列：搜尋與摺疊在前，可編輯時加上格式化、壓縮與靠右的復原／重做；放不下時從尾端收進「更多」下拉。 */
export function jsonEditorToolbarItems({
  labels,
  readOnly,
  hasParseError,
  canUndo,
  canRedo,
  onSearch,
  onExpandAll,
  onCollapseAll,
  onFormat,
  onCompact,
  onUndo,
  onRedo,
}: JsonEditorToolbarOptions): ToolbarItem[] {
  return [
    {
      key: 'search',
      label: labels.search,
      icon: <Icon name="search" size={16} />,
      iconOnly: true,
      onClick: onSearch,
    },
    {
      key: 'expand-all',
      label: labels.expandAll,
      icon: <Icon name="chevrons-up-down" size={16} />,
      iconOnly: true,
      onClick: onExpandAll,
    },
    {
      key: 'collapse-all',
      label: labels.collapseAll,
      icon: <Icon name="chevrons-down-up" size={16} />,
      iconOnly: true,
      onClick: onCollapseAll,
    },
    ...(readOnly
      ? []
      : [
          { key: 'format', label: labels.format, disabled: hasParseError, onClick: onFormat },
          { key: 'compact', label: labels.compact, disabled: hasParseError, onClick: onCompact },
          {
            key: 'undo',
            label: labels.undo,
            icon: <Icon name="undo" size={16} />,
            iconOnly: true,
            align: 'end' as const,
            disabled: !canUndo,
            onClick: onUndo,
          },
          {
            key: 'redo',
            label: labels.redo,
            icon: <Icon name="redo" size={16} />,
            iconOnly: true,
            align: 'end' as const,
            disabled: !canRedo,
            onClick: onRedo,
          },
        ]),
  ];
}
