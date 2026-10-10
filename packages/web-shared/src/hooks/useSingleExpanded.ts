import { useCallback, useState } from 'react';

/** 列表一次只展開一列：點同一列收合，點別列換過去（背景工作、稽核日誌的明細）。 */
export function useSingleExpanded(): {
  expandedId: string | undefined;
  onToggleExpand: (id: string) => void;
} {
  const [expandedId, setExpandedId] = useState<string>();
  const onToggleExpand = useCallback(
    (id: string) => setExpandedId((previous) => (previous === id ? undefined : id)),
    [],
  );
  return { expandedId, onToggleExpand };
}
