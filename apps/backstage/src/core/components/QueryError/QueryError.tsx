import type { ReactNode } from 'react';

import { Button } from '@/components/Button';
import { Empty } from '@/components/Empty';
import { useErrorMessage } from '@/core/errors';
import { useTranslation } from '@/core/locales';

export interface QueryErrorProps {
  error: unknown;
  /** 有值就顯示「重試」按鈕（通常是 query 的 `refetch`）。 */
  onRetry?: () => void;
  /** 重試之外的後續動作（例：詳情對話框的「回到列表」）。 */
  action?: ReactNode;
  className?: string;
  'data-testid'?: string;
}

/**
 * 查詢失敗的畫面：本地化的錯誤訊息＋重試。
 * 用來取代「查詢失敗時落到空狀態」——後端 5xx 時顯示「沒有資料」會讓人以為資料被刪光了
 * （docs/issues/04-user-experience.md UX-07、UX-21）。
 */
export function QueryError({
  error,
  onRetry,
  action,
  className,
  'data-testid': testId = 'query-error',
}: QueryErrorProps) {
  const { t } = useTranslation();
  const toMessage = useErrorMessage();
  return (
    <div role="alert" className={className} data-testid={testId}>
      <Empty
        title={toMessage(error)}
        action={
          (onRetry || action) && (
            <div className="flex justify-center gap-2">
              {action}
              {onRetry && (
                <Button onClick={onRetry} data-testid="query-error-retry">
                  {t('common.retry')}
                </Button>
              )}
            </div>
          )
        }
      />
    </div>
  );
}
