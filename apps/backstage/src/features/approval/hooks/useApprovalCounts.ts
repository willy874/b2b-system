import { useQuery } from '@tanstack/react-query';

import { getApprovalCountsQueryOptions } from '@/apis/approval/get-approval-counts/query';

/**
 * 待審數（docs/architecture/backend/20-approval.md §11.1）：側欄的徽章、首頁的待辦、列表的分頁標籤共用同一個查詢。
 * 推播與視窗聚焦時重抓（§12 D3）。
 */
export function useApprovalCounts() {
  return useQuery(getApprovalCountsQueryOptions()).data;
}

/** 側欄「我的審批」的徽章：待我審核。 */
export function useAssignedApprovalCount(): number | undefined {
  return useApprovalCounts()?.assigned;
}

/** 側欄「審批」的徽章：全部的待審（沒有 `approval:read` 時後端回 null）。 */
export function usePendingApprovalCount(): number | undefined {
  return useApprovalCounts()?.pending ?? undefined;
}
