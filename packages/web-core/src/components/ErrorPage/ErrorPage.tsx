import { Button } from '@b2b-system/ui/Button';
import { useRouter } from '@tanstack/react-router';
import type { ErrorComponentProps } from '@tanstack/react-router';
import type { ReactNode } from 'react';

import { isChunkLoadError, useErrorMessage } from '../../errors';
import { useTranslation } from '../../locales';
import { CopyErrorInfoButton } from './CopyErrorInfoButton';

import styles from './ErrorPage.module.css';

/**
 * 錯誤頁的版面：`centered` 在內容區置中、狀態碼放大（backstage）；`compact` 靠左、字級與內文相近（apps/platform）。
 * 兩個 app 原本各自的外觀，以參數保留。
 */
export type ErrorPageVariant = 'centered' | 'compact';

export interface ErrorPageVariantProps {
  /** 預設 `centered`。 */
  variant?: ErrorPageVariant;
}

export interface ErrorPageProps extends ErrorPageVariantProps {
  code?: string;
  title: string;
  description?: string;
  action?: ReactNode;
  'data-testid'?: string;
}

/** 錯誤頁的外框：狀態碼、標題、說明與後續動作。 */
export function ErrorPage({
  variant = 'centered',
  code,
  title,
  description,
  action,
  ...rest
}: ErrorPageProps) {
  return (
    <div className={styles.root} data-variant={variant} {...rest}>
      {code && <p className={styles.code}>{code}</p>}
      <h1 className={styles.title}>{title}</h1>
      {description && <p className={styles.description}>{description}</p>}
      {action && <div className={styles.actions}>{action}</div>}
    </div>
  );
}

/** 「回首頁」與「返回上一頁」：停在錯誤頁時不必靠側欄或網址列離開。 */
function LeaveActions() {
  const { t } = useTranslation();
  const router = useRouter();
  return (
    <>
      <Button
        variant="primary"
        onClick={() => void router.navigate({ to: '/' })}
        data-testid="error-page-home"
      >
        {t('error.page.backHome')}
      </Button>
      <Button onClick={() => router.history.back()} data-testid="error-page-back">
        {t('error.page.goBack')}
      </Button>
    </>
  );
}

/** 直接輸入無權限的網址時顯示這一頁（不導回首頁，網址保留著方便請人開權限）。 */
export function ForbiddenPage({ variant }: ErrorPageVariantProps) {
  const { t } = useTranslation();
  return (
    <ErrorPage
      variant={variant}
      code="403"
      title={t('error.page.forbidden.title')}
      description={t('error.page.forbidden.description')}
      action={<LeaveActions />}
      data-testid="forbidden-page"
    />
  );
}

/**
 * 當 `defaultNotFoundComponent` 時 router 會傳入 `NotFoundRouteProps`（用不到）。列出其中的 `data` 讓型別相容：
 * 全部欄位都是選填的型別不接受毫無交集的 props；直接引用 `NotFoundRouteProps` 會與 app 的 router 型別循環。
 */
export interface NotFoundPageProps extends ErrorPageVariantProps {
  data?: unknown;
}

/** 未知網址（打錯、書籤指向舊路由）：router 的 `defaultNotFoundComponent`。 */
export function NotFoundPage({ variant }: NotFoundPageProps) {
  const { t } = useTranslation();
  return (
    <ErrorPage
      variant={variant}
      code="404"
      title={t('error.page.notFound.title')}
      description={t('error.page.notFound.description')}
      action={<LeaveActions />}
      data-testid="not-found-page"
    />
  );
}

export interface UnexpectedErrorPageProps extends ErrorPageVariantProps {
  /** 有值時顯示後端錯誤的本地化說明（例：TENANT_UNAVAILABLE），否則用通用文案。 */
  error?: unknown;
  onRetry?: () => void;
}

/**
 * 不是路由本身出錯、而是頁面需要的資料拿不到（例：權限所依據的 profile 查詢失敗）：說明原因並提供重試。
 */
export function UnexpectedErrorPage({ variant, error, onRetry }: UnexpectedErrorPageProps) {
  const { t } = useTranslation();
  const toMessage = useErrorMessage();
  return (
    <ErrorPage
      variant={variant}
      code="500"
      title={t('error.page.unexpected.title')}
      description={error === undefined ? t('error.page.unexpected.description') : toMessage(error)}
      action={
        <>
          {onRetry && (
            <Button variant="primary" onClick={onRetry} data-testid="error-page-retry">
              {t('common.retry')}
            </Button>
          )}
          <CopyErrorInfoButton error={error} />
        </>
      }
      data-testid="unexpected-error-page"
    />
  );
}

export type RouteErrorPageProps = ErrorComponentProps & ErrorPageVariantProps;

/**
 * router 的 `defaultErrorComponent`：頁面載入或渲染失敗。chunk 載入失敗（部署了新版）提示重新整理；
 * 其他錯誤可以重試（重新執行 loader 並重畫）。不顯示技術訊息。
 */
export function RouteErrorPage({ variant, error, reset }: RouteErrorPageProps) {
  const { t } = useTranslation();
  const router = useRouter();
  if (isChunkLoadError(error)) {
    return (
      <ErrorPage
        variant={variant}
        title={t('error.page.updated.title')}
        description={t('error.page.updated.description')}
        action={
          <Button
            variant="primary"
            onClick={() => globalThis.location.reload()}
            data-testid="error-page-reload"
          >
            {t('error.page.reload')}
          </Button>
        }
        data-testid="app-updated-page"
      />
    );
  }
  return (
    <ErrorPage
      variant={variant}
      title={t('error.page.unexpected.title')}
      description={t('error.page.unexpected.description')}
      action={
        <>
          <Button
            variant="primary"
            onClick={() => {
              reset();
              void router.invalidate();
            }}
            data-testid="error-page-retry"
          >
            {t('common.retry')}
          </Button>
          <LeaveActions />
          <CopyErrorInfoButton error={error} />
        </>
      }
      data-testid="unexpected-error-page"
    />
  );
}
