import { useMemo, useState } from 'react';

import { fetchOrgUnitCreateMutation } from '@/apis/org-unit/create-org-unit/fetcher';
import { fetchOrgUnitDeleteMutation } from '@/apis/org-unit/delete-org-unit/fetcher';
import { fetchOrgUnitMoveMutation } from '@/apis/org-unit/move-org-unit/fetcher';
import { fetchOrgUnitUpdateMutation } from '@/apis/org-unit/update-org-unit/fetcher';
import { invalidateResources, Resource } from '@/apis/resources';
import type { OrgUnit } from '@/shared/api-sdk';

import {
  blankNodeIds,
  countPlanChanges,
  executeOrgChartPlan,
  planOrgChartChanges,
  toOrgChartValue,
} from '../pages/Organization/orgChart';
import type {
  OrgChartApi,
  OrgChartSaveFailure,
  OrgChartValue,
} from '../pages/Organization/orgChart';

const API: OrgChartApi = {
  create: (body) => fetchOrgUnitCreateMutation({ params: { body } }),
  rename: (id, body) => fetchOrgUnitUpdateMutation({ params: { unitId: id, body } }),
  move: (id, body) => fetchOrgUnitMoveMutation({ params: { unitId: id, body } }),
  remove: (id) => fetchOrgUnitDeleteMutation({ params: { unitId: id } }),
};

/**
 * 組織圖的編輯模式（docs/architecture/backend/23-organization.md §8）：進入時把目前的部門樹複製成草稿，
 * 在畫布上新增、改名、拖線換上層、刪除都只改草稿；「儲存」時算出計畫並依序呼叫 API。
 * 檢視模式直接顯示伺服器上的部門樹。
 */
export function useOrgChartEditor(units: readonly OrgUnit[] | undefined) {
  const [draft, setDraft] = useState<OrgChartValue>();
  const [saving, setSaving] = useState(false);
  const [failure, setFailure] = useState<OrgChartSaveFailure>();

  const serverValue = useMemo(() => toOrgChartValue(units ?? []), [units]);
  const plan = useMemo(
    () => (draft && units ? planOrgChartChanges(units, draft) : undefined),
    [draft, units],
  );
  const changeCount = plan ? countPlanChanges(plan) : 0;

  return {
    editing: Boolean(draft),
    value: draft ?? serverValue,
    setDraft,
    changeCount,
    /** 名稱空白的新節點：儲存前要補上。 */
    blankIds: draft ? blankNodeIds(draft) : [],
    saving,
    failure,
    /** 有未儲存的變更：離開頁面前要確認。 */
    isDirty: changeCount > 0,
    start: () => {
      setFailure(undefined);
      setDraft(serverValue);
    },
    cancel: () => {
      setFailure(undefined);
      setDraft(undefined);
    },
    /**
     * 成功回傳 true。失敗時前面的步驟已經生效：離開編輯模式（草稿裡已建立的新節點不能再送一次），
     * 帶著 `failure` 說明停在哪一步，畫面顯示伺服器的最新狀態，使用者從那裡再編輯。
     */
    save: async (): Promise<boolean> => {
      if (!draft || !units || !plan) return false;
      setSaving(true);
      setFailure(undefined);
      try {
        const result = await executeOrgChartPlan(plan, units, draft, API);
        if (result) setFailure(result);
        setDraft(undefined);
        return !result;
      } finally {
        setSaving(false);
        // 部分成功也要讓畫面拿到最新的樹與詳情
        invalidateResources([{ resource: Resource.ORG_UNIT, kind: 'update' }]);
      }
    },
  };
}

export type OrgChartEditorState = ReturnType<typeof useOrgChartEditor>;
