import { buildOrgUnitTree, filterOrgUnits } from '@/core/components/OrgUnitPicker';
import type { OrgUnitTreeNode } from '@/core/components/OrgUnitPicker';
import type { OrgUnit, OrgUnitMember } from '@/shared/api-sdk';

/** 左側樹的一個節點。 */
export interface OrgUnitTreeNodeVM {
  id: string;
  name: string;
  depth: number;
  memberCount: number;
  children: OrgUnitTreeNodeVM[];
}

function toNodeVM(node: OrgUnitTreeNode<OrgUnit>): OrgUnitTreeNodeVM {
  return {
    id: node.unit.id,
    name: node.unit.name,
    depth: node.depth,
    memberCount: node.unit.memberCount,
    children: node.children.map(toNodeVM),
  };
}

/** 扁平陣列 → 樹；有關鍵字時只留下符合的部門與它們的上層。 */
export function toOrgUnitTreeVM(units: readonly OrgUnit[], keyword: string): OrgUnitTreeNodeVM[] {
  return buildOrgUnitTree(filterOrgUnits(units, keyword)).map(toNodeVM);
}

/** 成員表的一列。 */
export interface OrgUnitMemberRowVM {
  userId: string;
  /** 這一列所屬的部門（「含下層部門」時同一個人可能出現在多個部門）。 */
  unitId: string;
  displayName: string;
  email: string;
  title: string | null;
  isManager: boolean;
  isPrimary: boolean;
  /** 「含下層部門」時，屬於下層部門的列顯示所屬部門名稱；直接成員是 `undefined`。 */
  descendantUnitName: string | undefined;
  /**
   * 這一列可以在這裡修改：有 `orgUnit:update`、是這個部門的直接成員（下層部門的成員到該部門改），
   * 而且不是自己（後端 403 `AUTHZ_SELF_MODIFY`，docs/architecture/backend/23-organization.md §10 D6）。
   */
  canEdit: boolean;
  isSelf: boolean;
}

export function toOrgUnitMemberRowVM(
  member: OrgUnitMember,
  context: { unitId: string; canUpdate: boolean; currentUserId: string | undefined },
): OrgUnitMemberRowVM {
  const isDirect = member.unitId === context.unitId;
  const isSelf = member.userId === context.currentUserId;
  return {
    userId: member.userId,
    unitId: member.unitId,
    displayName: member.displayName,
    email: member.email,
    title: member.title,
    isManager: member.isManager,
    isPrimary: member.isPrimary,
    descendantUnitName: isDirect ? undefined : member.unitName,
    canEdit: context.canUpdate && isDirect && !isSelf,
    isSelf,
  };
}
