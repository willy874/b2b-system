import { useMemo, useState } from 'react';

import { useTranslation } from '@/core/locales';
import {
  activeEdgeIds,
  layoutPermissionTree,
  permissionClosure,
  prerequisitePath,
} from '@/core/permission-graph';

import { implyingKeys, selectSkills, skillState, toggleSkill } from './permissionSkillTree';
import type { SkillState, ToggleResult } from './permissionSkillTree';
import { useGrantablePermissions } from './useGrantablePermissions';

export interface PermissionSkillTreeOptions {
  /** 角色明確授予的鍵（草稿）。 */
  explicit: ReadonlySet<string>;
  onChange: (next: Set<string>) => void;
  /** 整棵樹唯讀（沒有 `role:grantPermission`）。 */
  readOnly?: boolean;
  /** super-admin 角色：隱含全集、不能改。 */
  isSuperAdmin?: boolean;
}

/** 點了不能變更的節點時的說明（aria-live 念出）。 */
export type SkillNotice =
  | { key: string; kind: 'blocked'; by: string[] }
  | { key: string; kind: 'unavailable' };

const EMPTY: ReadonlySet<string> = new Set();

/** 下拉選單的一組：資源與它的權限鍵，依技能樹由上而下（基礎在前）的順序。 */
export interface SkillOptionGroup {
  resource: string;
  label: string;
  keys: string[];
}

/**
 * 角色權限技能樹的狀態：版面、每個節點的狀態、滑過時的前置路徑、點擊的互鎖
 * （docs/rbac/02-permission-catalog.md §9；規則在 `permissionSkillTree.ts`）。
 * 下拉選單與樹狀圖共用這一份狀態：任一邊改動，另一邊同步；在下拉選單選的鍵也會在樹狀圖上強調前置路徑。
 */
export function usePermissionSkillTree({
  explicit,
  onChange,
  readOnly = false,
  isSuperAdmin = false,
}: PermissionSkillTreeOptions) {
  const { t } = useTranslation();
  const { items, groups, isGrantable, loading } = useGrantablePermissions();
  const [focusKey, setFocusKey] = useState<string>();
  const [selectedKey, setSelectedKey] = useState<string>();
  const [notice, setNotice] = useState<SkillNotice>();

  const layout = useMemo(
    () => layoutPermissionTree(items, groups, (group) => t(group.nameI18nKey)),
    [items, groups, t],
  );
  const lit = useMemo(
    () =>
      isSuperAdmin
        ? new Set(items.map((item) => item.key as string))
        : permissionClosure(items, explicit),
    [items, explicit, isSuperAdmin],
  );
  const activeEdges = useMemo(() => activeEdgeIds(layout.edges, lit), [layout.edges, lit]);
  /** 滑過優先，其次是最後點選（樹狀圖或下拉選單）的鍵。 */
  const detailKey = focusKey ?? selectedKey;
  const path = useMemo(
    () =>
      detailKey
        ? prerequisitePath(items, detailKey, layout.edges)
        : { nodeIds: EMPTY, edgeIds: EMPTY },
    [items, detailKey, layout.edges],
  );
  const optionGroups = useMemo((): SkillOptionGroup[] => {
    const position = new Map(layout.nodes.map((node) => [node.id, node.position]));
    const rank = (key: string) => position.get(key) ?? { x: 0, y: 0 };
    return layout.groups.map((group) => ({
      resource: group.id,
      label: group.label,
      keys: group.nodeIds.toSorted((a, b) => rank(a).y - rank(b).y || rank(a).x - rank(b).x),
    }));
  }, [layout]);

  const stateOf = (key: string): SkillState =>
    isSuperAdmin ? 'implied' : skillState(items, key, explicit, isGrantable);

  /** 帶出這個鍵的明確鍵（遞迴）；super-admin 是空的。 */
  const impliedByOf = (key: string): string[] =>
    isSuperAdmin ? [] : implyingKeys(items, key, explicit);

  const apply = (key: string, result: ToggleResult) => {
    if (result.kind === 'changed') {
      setNotice(undefined);
      onChange(result.next);
    } else {
      setNotice(
        result.kind === 'blocked'
          ? { key, kind: 'blocked', by: result.by }
          : { key, kind: 'unavailable' },
      );
    }
  };

  /** 點樹狀圖上的節點。 */
  const toggle = (key: string) => {
    setSelectedKey(key);
    if (readOnly || isSuperAdmin) return;
    apply(key, toggleSkill(items, key, explicit, isGrantable));
  };

  /** 下拉選單的新值（亮著的鍵）：與目前亮著的比對出這次勾／取消的鍵，套用同一套互鎖。 */
  const select = (next: readonly string[]) => {
    if (readOnly || isSuperAdmin) return;
    const nextSet = new Set(next);
    const added = next.filter((key) => !lit.has(key));
    const removed = [...lit].filter((key) => !nextSet.has(key));
    const last = added.at(-1) ?? removed.at(-1);
    if (last === undefined) return;
    setSelectedKey(last);
    apply(last, selectSkills(items, explicit, added, removed, isGrantable));
  };

  return {
    loading,
    items,
    layout,
    optionGroups,
    /** 亮著的鍵：明確的 ＋ 它們帶出的（super-admin 是全部）。 */
    lit,
    activeEdges,
    path,
    stateOf,
    impliedByOf,
    toggle,
    select,
    focusKey,
    setFocusKey,
    /** 右側面板顯示、樹狀圖強調前置路徑的節點：滑過優先，其次是最後點選的。 */
    detailKey,
    notice,
    readOnly: readOnly || isSuperAdmin,
  };
}
