import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';

import { getRoleRevisionQueryOptions } from '@/apis/role/get-role-revision/query';
import { getRoleRevisionsQueryOptions } from '@/apis/role/get-role-revisions/query';

/** 版本列表一頁的筆數。 */
export const ROLE_REVISION_PAGE_SIZE = 20;

/** 差異的比較對象：目前的內容（最新一版）或前一版。 */
export type RoleRevisionCompareMode = 'current' | 'previous';

/**
 * 版本紀錄頁的狀態（docs/architecture/frontend/14-revisions.md）：版本列表（新的在前、分頁）、選中的一版、
 * 比較對象，以及 `JsonDiff` 的兩邊。
 *
 * - 「目前的內容」＝最新一版（每次寫入都產生一版，最新一版等於目前的角色；docs/architecture/backend/14-revisions.md §9.2 D1）。翻到後面的頁時仍要知道它，
 *   所以另外取第一筆。
 * - 「前一版」＝版本號減一；已被保留清理刪除時 `before` 為 undefined（`isBaseMissing`），差異顯示成整份新增。
 * - 沒有選的時候選最新一版。
 */
export function useRoleRevisionHistory(roleId: string) {
  const [offset, setOffset] = useState(0);
  const [picked, setPicked] = useState<number>();
  const [compare, setCompare] = useState<RoleRevisionCompareMode>('current');

  const list = useQuery(getRoleRevisionsQueryOptions(roleId, offset, ROLE_REVISION_PAGE_SIZE));
  const latest = useQuery({
    ...getRoleRevisionsQueryOptions(roleId, 0, 1),
    select: (data) => data.items[0],
  });
  const latestVersion = latest.data?.version;
  const selectedVersion = picked ?? latestVersion;
  const previousVersion =
    selectedVersion !== undefined && selectedVersion > 1 ? selectedVersion - 1 : undefined;

  const selected = useQuery({
    ...getRoleRevisionQueryOptions(roleId, selectedVersion ?? 0),
    enabled: selectedVersion !== undefined,
  });
  // 選的是最新一版時與 selected 是同一個 query（同一個 key）
  const current = useQuery({
    ...getRoleRevisionQueryOptions(roleId, latestVersion ?? 0),
    enabled: latestVersion !== undefined,
  });
  const previous = useQuery({
    ...getRoleRevisionQueryOptions(roleId, previousVersion ?? 0),
    enabled: compare === 'previous' && previousVersion !== undefined,
    // 前一版可能已被保留清理刪除（404）：不重試，直接當成沒有
    retry: false,
  });

  const before = compare === 'current' ? current.data?.snapshot : previous.data?.snapshot;

  return {
    items: list.data?.items ?? [],
    total: list.data?.pagination.total ?? 0,
    offset,
    limit: ROLE_REVISION_PAGE_SIZE,
    list,
    changePage: (next: number) => setOffset(next),
    selectedVersion,
    select: (version: number) => setPicked(version),
    compare,
    setCompare,
    latestVersion,
    /** 選的就是最新一版：與目前的內容相同，沒有東西可以還原。 */
    isLatest: selectedVersion !== undefined && selectedVersion === latestVersion,
    selected,
    /** 比較對象不存在（沒有前一版，或已被保留清理刪除）。 */
    isBaseMissing: compare === 'previous' && (previousVersion === undefined || previous.isError),
    /** `JsonDiff` 的兩邊：變更前是比較對象，變更後是選中的一版。 */
    before: before ?? undefined,
    after: selected.data?.snapshot ?? undefined,
    /** 目前的內容（最新一版的快照）；還原前據此判斷權限鍵會不會改變。 */
    currentSnapshot: current.data?.snapshot,
  };
}
