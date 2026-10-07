import type { EdgeChange, NodeChange } from '@xyflow/react';
import { useEffect, useMemo, useRef, useState } from 'react';

import { useLatestRef } from '../useLatestRef';

export interface TreeSelection {
  /** 選取的節點（React Flow 回報的原樣，可能含已經不存在的節點） */
  selectedNodeIds: ReadonlySet<string>;
  selectedEdgeIds: ReadonlySet<string>;
  /** 選取裡還存在的節點（刪除或復原之後會變少） */
  selectedIds: string[];
  hasSelection: boolean;
  /** React Flow 的節點變更裡的 `select` */
  applyNodeChanges: (changes: ReadonlyArray<NodeChange>) => void;
  /** React Flow 的 `onEdgesChange`：只處理 `select` */
  applyEdgeChanges: (changes: ReadonlyArray<EdgeChange>) => void;
  /** 只選這一個節點（新增之後） */
  selectOnly: (id: string) => void;
  clearEdges: () => void;
}

/**
 * TreeEditor 的選取：節點與連線各一份，只留還存在的節點，選取真的改變時才通知 `onSelectionChange`。
 */
export function useTreeSelection(
  nodes: ReadonlyArray<{ id: string }>,
  onSelectionChange: ((nodeIds: string[]) => void) | undefined,
): TreeSelection {
  const [selectedNodeIds, setSelectedNodeIds] = useState<ReadonlySet<string>>(new Set());
  const [selectedEdgeIds, setSelectedEdgeIds] = useState<ReadonlySet<string>>(new Set());

  // 刪除或復原之後，選取裡可能留著已經不存在的節點
  const existingNodeIds = useMemo(() => new Set(nodes.map((node) => node.id)), [nodes]);
  const selectedIds = useMemo(
    () => [...selectedNodeIds].filter((id) => existingNodeIds.has(id)),
    [selectedNodeIds, existingNodeIds],
  );
  // 以字串比較：換一份 value 時 selectedIds 是新陣列，但選取沒變就不通知
  const selectionKey = selectedIds.join('\n');
  const notifiedSelection = useRef(selectionKey);
  const latestOnSelectionChange = useLatestRef(onSelectionChange);
  useEffect(() => {
    if (notifiedSelection.current === selectionKey) return;
    notifiedSelection.current = selectionKey;
    latestOnSelectionChange.current?.(selectionKey === '' ? [] : selectionKey.split('\n'));
  }, [selectionKey, latestOnSelectionChange]);

  const applyNodeChanges = (changes: ReadonlyArray<NodeChange>) => {
    let next: Set<string> | undefined;
    for (const change of changes) {
      if (change.type !== 'select') continue;
      next ??= new Set(selectedNodeIds);
      if (change.selected) next.add(change.id);
      else next.delete(change.id);
    }
    if (next) setSelectedNodeIds(next);
  };

  const applyEdgeChanges = (changes: ReadonlyArray<EdgeChange>) => {
    let next: Set<string> | undefined;
    for (const change of changes) {
      if (change.type !== 'select') continue;
      next ??= new Set(selectedEdgeIds);
      if (change.selected) next.add(change.id);
      else next.delete(change.id);
    }
    if (next) setSelectedEdgeIds(next);
  };

  return {
    selectedNodeIds,
    selectedEdgeIds,
    selectedIds,
    hasSelection: selectedIds.length > 0 || selectedEdgeIds.size > 0,
    applyNodeChanges,
    applyEdgeChanges,
    selectOnly: (id) => {
      setSelectedNodeIds(new Set([id]));
      setSelectedEdgeIds(new Set());
    },
    clearEdges: () => setSelectedEdgeIds(new Set()),
  };
}
