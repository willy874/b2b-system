import { Button } from '@b2b-system/ui/Button';
import { useEffect, useRef, useState } from 'react';

import { AppError } from '../../errors';
import { useTranslation } from '../../locales';
import { getTelemetryContext } from '../../telemetry';

import styles from './ErrorPage.module.css';

const COPIED_RESET_MS = 3000;

export interface CopyErrorInfoButtonProps {
  /** 頁面上顯示的錯誤；是 `AppError` 時以它的 `requestId` 當代碼（後端日誌查得到）。 */
  error?: unknown;
}

/**
 * 「複製錯誤資訊」（docs/architecture/frontend/19-observability.md §6）：事件 id（或後端的 requestId）、release、
 * 時間、頁面的 path 樣板，貼給管理員就能在 apps/apm-service 或後端日誌找到這一筆。
 * 事件 id 在點擊時才讀：React 在錯誤頁畫出來之後才呼叫 `onCaughtError` 上報。
 */
export function CopyErrorInfoButton({ error }: CopyErrorInfoButtonProps) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  /** 寫不進剪貼簿（非安全環境、權限被拒）時顯示在頁面上的文字。 */
  const [fallback, setFallback] = useState<string>();
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => () => clearTimeout(timer.current), []);

  const copy = async () => {
    const context = getTelemetryContext();
    const requestId = error instanceof AppError ? error.requestId : undefined;
    const text = t('error.page.info', {
      code: requestId ?? context.eventId ?? '-',
      release: context.release,
      time: new Date().toISOString(),
      route: context.route ?? globalThis.location.pathname,
    });
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // 非安全環境或權限被拒：把內容顯示出來，使用者自己選取複製
      setFallback(text);
      return;
    }
    setFallback(undefined);
    setCopied(true);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), COPIED_RESET_MS);
  };

  return (
    <>
      <Button variant="secondary" onClick={() => void copy()} data-testid="error-page-copy-info">
        {copied ? t('error.page.copied') : t('error.page.copyInfo')}
      </Button>
      {fallback !== undefined && (
        <p className={styles.copyFallback} data-testid="error-page-copy-info-text">
          {t('error.page.copyFailed')} {fallback}
        </p>
      )}
    </>
  );
}
