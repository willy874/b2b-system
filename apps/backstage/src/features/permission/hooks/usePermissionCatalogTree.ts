import { useMemo, useState } from 'react';

import { useTranslation } from '@/core/locales';
import {
  activeEdgeIds,
  dependentKeys,
  layoutPermissionTree,
  permissionClosure,
  prerequisitePath,
} from '@/core/permission-graph';
import type { Permission, PermissionCatalog } from '@/shared/api-sdk';

const EMPTY: ReadonlySet<string> = new Set();

export interface PermissionCatalogTreeOptions {
  /** 完整的目錄：說明面板的關係（包含、依賴、被誰帶出）不受篩選影響。 */
  catalog: PermissionCatalog;
  /** 套用篩選後要畫在畫布上的部分；省略是整份目錄。 */
  visible?: PermissionCatalog;
  /** 目前使用者持有的鍵（已是閉包）。 */
  held: ReadonlySet<string>;
  /** 選取的權限鍵（網址）。 */
  selectedKey?: string;
}

export interface PermissionDetail {
  item: Permission;
  held: boolean;
  /** 直接的子能力（同一資源）。 */
  includes: string[];
  /** 直接的依賴（跨資源的 read）。 */
  requires: string[];
  /** 直接包含或依賴它的鍵：持有那些鍵就會帶來它。 */
  dependents: string[];
  /** 持有它就（遞迴）帶來的鍵，不含自己。 */
  grants: string[];
}

/**
 * 權限目錄的樹狀圖（唯讀，docs/rbac/02-permission-catalog.md §9）：
 * 版面與角色的技能樹相同；節點以「你持有／未持有」著色，滑過強調前置路徑，點選在說明面板顯示詳細資訊。
 * 篩選只決定畫哪些節點；點選被篩掉的權限（從說明面板的關係跳過去）仍顯示它的說明。
 */
export function usePermissionCatalogTree({
  catalog,
  visible = catalog,
  held,
  selectedKey,
}: PermissionCatalogTreeOptions) {
  const { t } = useTranslation();
  const [focusKey, setFocusKey] = useState<string>();

  const layout = useMemo(
    () => layoutPermissionTree(visible.items, visible.groups, (group) => t(group.nameI18nKey)),
    [visible, t],
  );
  const heldEdges = useMemo(() => activeEdgeIds(layout.edges, held), [layout.edges, held]);
  const byKey = useMemo(
    () => new Map(catalog.items.map((item) => [item.key as string, item])),
    [catalog.items],
  );
  /** 網址上的鍵不在目錄裡（舊連結、手打）時當成沒選。 */
  const selected = selectedKey !== undefined && byKey.has(selectedKey) ? selectedKey : undefined;
  /** 滑過優先，其次是點選的鍵。 */
  const detailKey = focusKey ?? selected;
  const path = useMemo(
    () =>
      detailKey
        ? prerequisitePath(catalog.items, detailKey, layout.edges)
        : { nodeIds: EMPTY, edgeIds: EMPTY },
    [catalog.items, detailKey, layout.edges],
  );

  const detail = useMemo((): PermissionDetail | undefined => {
    const item = detailKey ? byKey.get(detailKey) : undefined;
    if (!item) return undefined;
    const grants = permissionClosure(catalog.items, [item.key]);
    grants.delete(item.key);
    return {
      item,
      held: held.has(item.key),
      includes: [...item.includes],
      requires: [...item.requires],
      dependents: dependentKeys(catalog.items, item.key),
      grants: [...grants],
    };
  }, [detailKey, byKey, catalog.items, held]);

  return {
    layout,
    heldEdges,
    path,
    selectedKey: selected,
    detail,
    setFocusKey,
    /** 權限鍵的顯示名稱；語系包還沒載入時退回權限鍵。 */
    nameOf: (key: string): string => {
      const item = byKey.get(key);
      return (item && t(item.nameI18nKey)) || key;
    },
  };
}
