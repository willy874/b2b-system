import { useMemo } from 'react';

import { useIsFeatureReady } from '@/core/feature';
import type { ApprovalFlowList } from '@/shared/api-sdk';

import { GROUP_FEATURE_ID, ORGANIZATION_FEATURE_ID } from '../constants';
import type { AssigneeKind } from '../constants';

/** 不能用的原因（語系鍵）；能用時為 undefined。 */
export type AssigneeKindAvailability = Record<AssigneeKind, string | undefined>;

const ORGANIZATION_DISABLED = 'approvalFlow.assignee.unavailable.organization';
const GROUP_DISABLED = 'approvalFlow.assignee.unavailable.group';

/**
 * 各種審核者規則現在能不能用（docs/architecture/backend/20-approval.md §9.12、§10.2 D14）：後端 `assigneeKinds` 是取得當下的狀態，
 * 另以 feature 的安裝狀態即時反映平台的開關（打開或關掉組織管理、群組時不必重新整理）。
 */
export function useAssigneeKindAvailability(
  kinds: ApprovalFlowList['assigneeKinds'] | undefined,
): AssigneeKindAvailability {
  const isOrganizationReady = useIsFeatureReady(ORGANIZATION_FEATURE_ID);
  const isGroupReady = useIsFeatureReady(GROUP_FEATURE_ID);

  return useMemo(() => {
    const organization = isOrganizationReady ? undefined : ORGANIZATION_DISABLED;
    return {
      user: undefined,
      role: undefined,
      group: isGroupReady && kinds?.group !== false ? undefined : GROUP_DISABLED,
      manager: kinds?.manager === false ? ORGANIZATION_DISABLED : organization,
      orgUnit: kinds?.orgUnit === false ? ORGANIZATION_DISABLED : organization,
    };
  }, [kinds, isGroupReady, isOrganizationReady]);
}
