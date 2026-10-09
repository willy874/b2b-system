import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import { getApprovalListQueryOptions } from '@/apis/approval/get-approval-list/query';
import type { ApprovalListParams } from '@/apis/approval/types';

/**
 * 決定後的「下一筆」（docs/architecture/backend/20-approval.md §11.3、§12 D5）：從待審清單點進來的詳情，定案後前往
 * 同一份清單（同樣的篩選與頁碼）裡排在它後面、仍在清單上的那一筆。
 *
 * 進入詳情時記下清單當時的順序（列表剛載入過，快取裡有）；定案後重新取得清單，從原本排在後面的找起。
 * 原本排在後面的都不在了（例：都被別人處理掉），就取新清單裡第一筆不是這筆、也不是原本排在前面的。
 * 回傳 `undefined`：這一頁都處理完了。`params` 為 undefined（不是從待審清單進來）時不找。
 */
export function useNextApproval(approvalId: string, params: ApprovalListParams | undefined) {
  const queryClient = useQueryClient();
  const options = params && getApprovalListQueryOptions({ params });
  // 詳情以 approvalId 為 key 掛載：換到下一筆時重新記下清單
  const [before] = useState(
    () =>
      (options && queryClient.getQueryData(options.queryKey)?.items.map((item) => item.id)) ?? [],
  );

  return async (): Promise<string | undefined> => {
    if (!options) return undefined;
    const after = await queryClient.fetchQuery({ ...options, staleTime: 0 });
    const remaining = new Set(after.items.map((item) => item.id));
    remaining.delete(approvalId);
    const index = before.indexOf(approvalId);
    const following = before.slice(index + 1).find((id) => remaining.has(id));
    if (following) return following;
    const earlier = new Set(index > 0 ? before.slice(0, index) : []);
    return after.items.find((item) => remaining.has(item.id) && !earlier.has(item.id))?.id;
  };
}
