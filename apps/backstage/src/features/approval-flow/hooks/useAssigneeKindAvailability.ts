import { useMemo } from 'react';

import { useIsFeatureReady } from '@/core/feature';
import type { ApprovalFlowList } from '@/shared/api-sdk';

import { GROUP_FEATURE_ID, ORGANIZATION_FEATURE_ID } from '../constants';
import type { AssigneeKind } from '../constants';

/** 各種審核者規則現在能不能用。 */
export type AssigneeKindAvailability = Record<AssigneeKind, boolean>;

/**
 * 各種審核者規則現在能不能用（docs/architecture/backend/20-approval.md §9.12、§10.2 D14）：後端 `assigneeKinds` 是取得當下的狀態，
 * 另以 feature 的安裝狀態即時反映平台的開關（打開或關掉組織管理、群組時不必重新整理）。
 * 不能用的原因都是 feature 沒有啟用：畫面上不說明原因，直接不列出那個種類（docs/architecture/frontend/02-plugin-system.md §7）。
 */
export function useAssigneeKindAvailability(
  kinds: ApprovalFlowList['assigneeKinds'] | undefined,
): AssigneeKindAvailability {
  const isOrganizationReady = useIsFeatureReady(ORGANIZATION_FEATURE_ID);
  const isGroupReady = useIsFeatureReady(GROUP_FEATURE_ID);

  return useMemo(
    () => ({
      user: true,
      role: true,
      group: isGroupReady && kinds?.group !== false,
      manager: isOrganizationReady && kinds?.manager !== false,
      orgUnit: isOrganizationReady && kinds?.orgUnit !== false,
    }),
    [kinds, isGroupReady, isOrganizationReady],
  );
}
