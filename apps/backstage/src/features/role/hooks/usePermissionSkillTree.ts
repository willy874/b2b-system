import { useMemo, useState } from 'react';

import { useTranslation } from '@/core/locales';

import {
  activeEdgeIds,
  implyingKeys,
  layoutSkillTree,
  permissionClosure,
  prerequisitePath,
  skillState,
  toggleSkill,
} from './permissionSkillTree';
import type { SkillState } from './permissionSkillTree';
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

/**
 * 角色權限技能樹的狀態：版面、每個節點的狀態、滑過時的前置路徑、點擊的互鎖
 * （docs/rbac/02-permission-catalog.md §9；規則在 `permissionSkillTree.ts`）。
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
    () => layoutSkillTree(items, groups, (group) => t(group.nameI18nKey)),
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
  const path = useMemo(
    () =>
      focusKey
        ? prerequisitePath(items, focusKey, layout.edges)
        : { nodeIds: EMPTY, edgeIds: EMPTY },
    [items, focusKey, layout.edges],
  );

  const stateOf = (key: string): SkillState =>
    isSuperAdmin ? 'implied' : skillState(items, key, explicit, isGrantable);

  /** 帶出這個鍵的明確鍵（遞迴）；super-admin 是空的。 */
  const impliedByOf = (key: string): string[] =>
    isSuperAdmin ? [] : implyingKeys(items, key, explicit);

  const toggle = (key: string) => {
    setSelectedKey(key);
    if (readOnly || isSuperAdmin) return;
    const result = toggleSkill(items, key, explicit, isGrantable);
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

  return {
    loading,
    items,
    layout,
    activeEdges,
    path,
    stateOf,
    impliedByOf,
    toggle,
    focusKey,
    setFocusKey,
    /** 右側面板顯示的節點：滑過優先，其次是最後點的。 */
    detailKey: focusKey ?? selectedKey,
    notice,
    readOnly: readOnly || isSuperAdmin,
  };
}
