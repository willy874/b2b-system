import { Skeleton } from '@b2b-system/ui/Skeleton';
import type { ReactNode } from 'react';

import { isNotFound } from '../../errors';
import { QueryError } from '../QueryError';
import type { QuerySectionState } from '../QuerySection';

export interface QueryBoundaryProps<T> {
  query: QuerySectionState<T>;
  /** 有資料時的內容。 */
  children: (data: T) => ReactNode;
  /** 載入中；預設一塊 160px 高的骨架。 */
  skeleton?: ReactNode;
  /**
   * 錯誤畫面上重試之外的後續動作（例：詳情對話框的「回到列表」）。
   * web-core 不認識各 app 的路由，返回的導向由呼叫端決定。
   */
  backAction?: ReactNode;
  /** 錯誤畫面的 testid。 */
  'data-testid'?: string;
}

/**
 * 以路由開啟的詳情（對話框、面板）的查詢狀態：載入中 → 骨架；失敗 → 錯誤訊息＋重試＋返回；有資料 → `children(data)`。
 * 查無資料（`isNotFound`，例：深層連結指向已刪除的資源）時不給重試——再試一次也一樣，只提供返回。
 * 對話框的外框（標題、footer、尺寸）留在各頁；頁面裡的一個區塊用 `QuerySection`。
 */
export function QueryBoundary<T>({
  query,
  children,
  skeleton,
  backAction,
  'data-testid': testId,
}: QueryBoundaryProps<T>) {
  if (query.data !== undefined) return <>{children(query.data)}</>;
  if (query.isError) {
    return (
      <QueryError
        error={query.error}
        onRetry={isNotFound(query.error) ? undefined : () => void query.refetch()}
        action={backAction}
        data-testid={testId}
      />
    );
  }
  return <>{skeleton ?? <Skeleton height={160} />}</>;
}
