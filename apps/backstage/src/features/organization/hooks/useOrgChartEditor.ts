import { useMemo, useState } from 'react';

import { fetchOrgUnitCreateMutation } from '@/apis/org-unit/create-org-unit/fetcher';
import { fetchOrgUnitDeleteMutation } from '@/apis/org-unit/delete-org-unit/fetcher';
import { fetchOrgUnitMoveMutation } from '@/apis/org-unit/move-org-unit/fetcher';
import { fetchOrgUnitUpdateMutation } from '@/apis/org-unit/update-org-unit/fetcher';
import { invalidateResources, Resource } from '@/apis/resources';
import type { OrgUnit } from '@/shared/api-sdk';

import {
  blankNodeIds,
  conflictingDeletes,
  countPlanChanges,
  executeOrgChartPlan,
  hasOrgChartChanged,
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
 *
 * 編輯期間部門樹會因推播、切回分頁而重抓：計畫與 `version` 一律以進入編輯時的樹（`base`）計算，
 * 別人的新增、改名、搬移不會變成這次的變更，改到同一個部門時由樂觀鎖回 409；刪除不帶 `version`，送出前另外比對。
 */
export function useOrgChartEditor(units: readonly OrgUnit[] | undefined) {
  const [base, setBase] = useState<readonly OrgUnit[]>();
  const [draft, setDraftValue] = useState<OrgChartValue>();
  const [saving, setSaving] = useState(false);
  const [failure, setFailure] = useState<OrgChartSaveFailure>();
  /** 儲存被擋下：要刪除的部門在編輯期間被別人改過（名稱取自 `base`）。 */
  const [deleteConflicts, setDeleteConflicts] = useState<string[]>([]);

  const serverValue = useMemo(() => toOrgChartValue(units ?? []), [units]);
  const plan = useMemo(
    () => (draft && base ? planOrgChartChanges(base, draft) : undefined),
    [draft, base],
  );
  const changeCount = plan ? countPlanChanges(plan) : 0;

  const start = () => {
    if (!units) return;
    setFailure(undefined);
    setDeleteConflicts([]);
    setBase(units);
    setDraftValue(serverValue);
  };

  return {
    editing: Boolean(draft),
    value: draft ?? serverValue,
    setDraft: (value: OrgChartValue) => {
      setDeleteConflicts([]);
      setDraftValue(value);
    },
    changeCount,
    /** 名稱空白的新節點：儲存前要補上。 */
    blankIds: draft ? blankNodeIds(draft) : [],
    saving,
    failure,
    deleteConflicts,
    /** 進入編輯模式之後，伺服器上的部門樹被別人改過：提示可以放棄草稿、以最新的樹重新開始（`start`）。 */
    outdated: Boolean(draft && base && units && hasOrgChartChanged(base, units)),
    /** 有未儲存的變更：離開頁面前要確認。 */
    isDirty: changeCount > 0,
    /** 進入編輯模式；編輯中呼叫則放棄草稿、以伺服器上最新的樹重新開始。 */
    start,
    cancel: () => {
      setFailure(undefined);
      setDeleteConflicts([]);
      setBase(undefined);
      setDraftValue(undefined);
    },
    /**
     * 成功回傳 true。失敗時前面的步驟已經生效：離開編輯模式（草稿裡已建立的新節點不能再送一次），
     * 帶著 `failure` 說明停在哪一步，畫面顯示伺服器的最新狀態，使用者從那裡再編輯。
     * 要刪除的部門被別人改過時什麼都不送出，留在編輯模式並以 `deleteConflicts` 說明。
     */
    save: async (): Promise<boolean> => {
      if (!draft || !base || !units || !plan) return false;
      const conflicts = conflictingDeletes(plan, base, units);
      if (conflicts.length) {
        const names = new Map(base.map((unit) => [unit.id, unit.name]));
        setDeleteConflicts(conflicts.map((id) => names.get(id) ?? id));
        return false;
      }
      setSaving(true);
      setFailure(undefined);
      try {
        const result = await executeOrgChartPlan(plan, base, draft, API);
        if (result) setFailure(result);
        setBase(undefined);
        setDraftValue(undefined);
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
