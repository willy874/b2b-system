import { Button } from '@b2b-system/ui/Button';
import { Skeleton } from '@b2b-system/ui/Skeleton';
import type { ReactNode } from 'react';

import { useErrorMessage } from '../../errors';
import { useTranslation } from '../../locales';

/** `QuerySection` 用到的 query 欄位；TanStack Query 的 `useQuery()` 結果可以直接傳入。 */
export interface QuerySectionState<T> {
  data: T | undefined;
  isError: boolean;
  error: unknown;
  refetch: () => unknown;
}

export interface QuerySectionProps<T> {
  query: QuerySectionState<T>;
  /** 有資料時的內容；空清單的「無」由這裡決定，載入中與失敗不會進來。 */
  children: (data: T) => ReactNode;
  /** 載入中骨架的高度（px），與內容大致相同可以避免版面跳動。 */
  skeletonHeight?: number;
  /** 錯誤列的 testid；重試按鈕固定是 `query-error-retry`（與 `QueryError`、`RichTable` 相同）。 */
  'data-testid'?: string;
}

/**
 * 頁面裡一個區塊的查詢狀態：載入中 → 骨架；沒有資料又失敗 → 錯誤訊息＋重試；有資料 → `children(data)`。
 * 有舊資料又失敗時保留內容並在上方提示（與 `RichTable` 一致）。
 *
 * 區塊不能把 `data === undefined`（載入中或失敗）畫成「無」：管理者會以為角色沒有權限、群組沒有成員
 * （docs/architecture/frontend/07-ui-system.md §6.1）。「沒有權限看這個區塊」由呼叫端決定不渲染，不經過這裡。
 */
export function QuerySection<T>({
  query,
  children,
  skeletonHeight = 32,
  'data-testid': testId = 'query-section-error',
}: QuerySectionProps<T>) {
  if (query.data !== undefined) {
    return (
      <>
        {query.isError && (
          <QuerySectionAlert
            stale
            error={query.error}
            onRetry={() => void query.refetch()}
            testId={testId}
          />
        )}
        {children(query.data)}
      </>
    );
  }
  if (query.isError) {
    return (
      <QuerySectionAlert error={query.error} onRetry={() => void query.refetch()} testId={testId} />
    );
  }
  return <Skeleton height={skeletonHeight} data-testid="query-section-loading" />;
}

interface QuerySectionAlertProps {
  error: unknown;
  onRetry: () => void;
  /** 有舊資料：說明目前顯示的是先前的結果 */
  stale?: boolean;
  testId: string;
}

/** 區塊用的精簡錯誤列：區塊通常只有幾行高，`QueryError` 的整塊空狀態會撐開版面。 */
function QuerySectionAlert({ error, onRetry, stale, testId }: QuerySectionAlertProps) {
  const { t } = useTranslation();
  const toMessage = useErrorMessage();
  const message = toMessage(error);
  return (
    <div
      role="alert"
      className="flex items-center justify-between gap-2 rounded-[var(--radius-md)] border border-[var(--color-warning)] px-3 py-2 text-sm"
      data-testid={testId}
      data-stale={stale || undefined}
    >
      <span>{stale ? t('common.staleData', { message }) : message}</span>
      <Button size="sm" onClick={onRetry} data-testid="query-error-retry">
        {t('common.retry')}
      </Button>
    </div>
  );
}
