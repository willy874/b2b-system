import { useTranslation } from '@/core/locales';
import type { PlatformAuditLog } from '@/shared/api-sdk';
import { cn } from '@/shared/utils';

import { AUDIT_LOG_RESULT_DOT_CLASS, AUDIT_LOG_RESULT_LABEL_KEY } from '../../../constants';

interface AuditLogResultProps {
  result: PlatformAuditLog['result'];
  errorCode: string | null;
}

/** 成功／失敗；失敗時顯示錯誤碼（沒有錯誤碼才顯示「失敗」）。 */
export function AuditLogResult({ result, errorCode }: AuditLogResultProps) {
  const { t } = useTranslation();
  return (
    <span
      className="inline-flex items-center gap-1.5 text-sm"
      data-testid="audit-log-result"
      data-value={result}
    >
      <span
        className={cn('inline-block h-2 w-2 rounded-full', AUDIT_LOG_RESULT_DOT_CLASS[result])}
        aria-hidden
      />
      {result === 'failure' && errorCode ? (
        <code className="font-mono text-xs">{errorCode}</code>
      ) : (
        t(AUDIT_LOG_RESULT_LABEL_KEY[result])
      )}
    </span>
  );
}
