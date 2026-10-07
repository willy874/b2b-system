import { Icon } from '@b2b-system/ui/Icon';
import { TreeEditor } from '@b2b-system/ui/TreeEditor';
import { useTranslation } from '@b2b-system/web-core/locales';
import { cn } from '@b2b-system/web-shared/utils';
import { useMemo, useState } from 'react';

import {
  activeEdgeIds,
  layoutPermissionTree,
  PERMISSION_NODE_SIZE,
  prerequisitePath,
} from '@/core/permission-graph';
import type { PermissionNodeData, PermissionTreeGroup } from '@/core/permission-graph';

import type { PermissionSourceGroup, PermissionSourceItem } from './permissionSourceModel';
import { isImpliedOnly } from './permissionSourceModel';

const EMPTY: ReadonlySet<string> = new Set();

interface PermissionSourceTreeProps {
  /** 套用搜尋與篩選後要畫的權限（依資源分組）。 */
  groups: readonly PermissionSourceGroup[];
  /** 全部的有效權限：滑過時的前置路徑不受篩選影響。 */
  items: readonly PermissionSourceItem[];
  selectedKey: string | undefined;
  onSelect: (item: PermissionSourceItem) => void;
}

/**
 * 有效權限的樹狀圖（docs/architecture/iam/08-explain.md §5）：版面與權限目錄的樹相同（`core/permission-graph`），
 * 只畫這位使用者持有的權限；明確授予與只由依賴帶出的以不同狀態表示，滑過強調前置路徑，點一個節點在右側看來源。
 */
export function PermissionSourceTree({
  groups,
  items,
  selectedKey,
  onSelect,
}: PermissionSourceTreeProps) {
  const { t } = useTranslation();
  const [focusKey, setFocusKey] = useState<string>();

  const visible = useMemo(() => groups.flatMap((group) => group.items), [groups]);
  const layout = useMemo(() => {
    const treeGroups: PermissionTreeGroup[] = groups.map((group) => ({
      resource: group.resource,
      nameI18nKey: group.resourceNameI18nKey,
      keys: group.items.map((item) => item.key),
    }));
    return layoutPermissionTree(visible, treeGroups, (group) => t(group.nameI18nKey));
  }, [groups, visible, t]);
  const byKey = useMemo(() => new Map(items.map((item) => [item.key, item])), [items]);
  // 畫出來的都是持有的權限：所有連線都亮著
  const heldEdges = useMemo(
    () => activeEdgeIds(layout.edges, new Set(byKey.keys())),
    [layout.edges, byKey],
  );
  const pathKey = focusKey ?? selectedKey;
  const path = useMemo(
    () =>
      pathKey ? prerequisitePath(items, pathKey, layout.edges) : { nodeIds: EMPTY, edgeIds: EMPTY },
    [items, pathKey, layout.edges],
  );

  return (
    <div className="flex h-full flex-col gap-2" data-testid="permission-source-tree">
      <div className="min-h-0 flex-1">
        <TreeEditor<PermissionNodeData>
          // 搜尋或篩選改變畫哪些節點時重新掛上，讓畫布重新「顯示全部」（fitView 只在掛上時執行）
          key={layout.nodes.map((node) => node.id).join(',')}
          value={layout}
          mode="dag"
          direction="TB"
          layout="manual"
          readOnly
          selectable={false}
          showMinimap={false}
          // 填滿對話框裡的格子（高度隨斷點不同）：根元素撐滿，畫布吃掉工具列以外的空間
          height="auto"
          className="flex h-full flex-col"
          classNames={{ canvas: 'min-h-0 flex-1' }}
          nodeSize={PERMISSION_NODE_SIZE}
          groups={layout.groups}
          getNodeLabel={(node) => t(node.data.nameI18nKey)}
          getNodeState={(node) => {
            const item = byKey.get(node.id);
            return item && isImpliedOnly(item) ? 'derived' : 'active';
          }}
          highlightedNodeIds={path.nodeIds}
          activeEdgeIds={heldEdges}
          highlightedEdgeIds={path.edgeIds}
          renderNode={(node) => {
            const item = byKey.get(node.id);
            if (!item) return null;
            const isImplied = isImpliedOnly(item);
            const isSelected = node.id === selectedKey;
            return (
              <button
                type="button"
                aria-pressed={isSelected}
                aria-label={t('common.withNote', {
                  name: t(node.data.nameI18nKey),
                  note: isImplied ? t('explain.list.implied') : t('explain.granted'),
                })}
                className={cn(
                  'nodrag flex w-full min-w-0 cursor-pointer items-center gap-1.5 border-0 bg-transparent p-0',
                  'text-start text-inherit',
                  isSelected && 'font-semibold',
                )}
                onClick={() => onSelect(item)}
                onMouseEnter={() => setFocusKey(node.id)}
                onMouseLeave={() => setFocusKey(undefined)}
                onFocus={() => setFocusKey(node.id)}
                onBlur={() => setFocusKey(undefined)}
                data-testid="permission-source-node"
                data-value={node.id}
                data-implied={isImplied || undefined}
              >
                <Icon name={isImplied ? 'network' : 'check'} size={14} />
                <span className="truncate">{t(node.data.nameI18nKey)}</span>
              </button>
            );
          }}
          aria-label={t('explain.view.tree')}
        />
      </div>
      <ul className="m-0 flex list-none flex-wrap gap-x-4 gap-y-1 p-0 text-xs text-[var(--color-fg-muted)]">
        <li className="flex items-center gap-1.5">
          <Icon name="check" size={14} />
          {t('explain.granted')}
        </li>
        <li className="flex items-center gap-1.5">
          <Icon name="network" size={14} />
          {t('explain.list.implied')}
        </li>
        <li>{t('explain.tree.hint')}</li>
      </ul>
    </div>
  );
}
