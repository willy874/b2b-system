import { useRouter } from '@tanstack/react-router';
import type { ErrorComponentProps } from '@tanstack/react-router';
import type { ReactNode } from 'react';

import { Button } from '@/components/Button';
import { useErrorMessage } from '@/core/errors';
import { useTranslation } from '@/core/locales';

import './ErrorPage.css';

export interface ErrorPageProps {
  code?: string;
  title: string;
  description?: string;
  action?: ReactNode;
  'data-testid'?: string;
}

export function ErrorPage({ code, title, description, action, ...rest }: ErrorPageProps) {
  return (
    <div className="ge-error-page" {...rest}>
      {code && <p className="ge-error-page__code">{code}</p>}
      <h1 className="ge-error-page__title">{title}</h1>
      {description && <p className="ge-error-page__description">{description}</p>}
      {action && (
        <div className="ge-error-page__action flex flex-wrap justify-center gap-2">{action}</div>
      )}
    </div>
  );
}

/**
 * 部署新版後，舊分頁 lazy 載入的舊 chunk 已經不在伺服器上。各瀏覽器的訊息不同：
 * Chrome「Failed to fetch dynamically imported module」、Firefox「error loading dynamically imported module」、
 * Safari「Importing a module script failed」；Vite 的 preload 失敗則是「Unable to preload CSS」。
 * （與 apps/auth 的 app/ErrorPages.tsx 相同）
 */
const CHUNK_ERROR_PATTERN =
  /Failed to fetch dynamically imported module|error loading dynamically imported module|Importing a module script failed|Unable to preload CSS/i;

export function isChunkLoadError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return error.name === 'ChunkLoadError' || CHUNK_ERROR_PATTERN.test(error.message);
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
export function ForbiddenPage() {
  const { t } = useTranslation();
  return (
    <ErrorPage
      code="403"
      title={t('error.page.forbidden.title')}
      description={t('error.page.forbidden.description')}
      action={<LeaveActions />}
      data-testid="forbidden-page"
    />
  );
}

/** 未知網址（打錯、書籤指向舊路由）：router 的 `defaultNotFoundComponent`。 */
export function NotFoundPage() {
  const { t } = useTranslation();
  return (
    <ErrorPage
      code="404"
      title={t('error.page.notFound.title')}
      description={t('error.page.notFound.description')}
      action={<LeaveActions />}
      data-testid="not-found-page"
    />
  );
}

export interface UnexpectedErrorPageProps {
  /** 有值時顯示後端錯誤的本地化說明（例：TENANT_UNAVAILABLE），否則用通用文案。 */
  error?: unknown;
  onRetry?: () => void;
}

export function UnexpectedErrorPage({ error, onRetry }: UnexpectedErrorPageProps) {
  const { t } = useTranslation();
  const toMessage = useErrorMessage();
  return (
    <ErrorPage
      code="500"
      title={t('error.page.unexpected.title')}
      description={error === undefined ? t('error.page.unexpected.description') : toMessage(error)}
      action={
        onRetry && (
          <Button variant="primary" onClick={onRetry} data-testid="error-page-retry">
            {t('common.retry')}
          </Button>
        )
      }
      data-testid="unexpected-error-page"
    />
  );
}

/**
 * router 的 `defaultErrorComponent`：頁面載入或渲染失敗。chunk 載入失敗（部署了新版）提示重新整理；
 * 其他錯誤可以重試（重新執行 loader 並重畫）。不顯示技術訊息。
 */
export function RouteErrorPage({ error, reset }: ErrorComponentProps) {
  const { t } = useTranslation();
  const router = useRouter();
  if (isChunkLoadError(error)) {
    return (
      <ErrorPage
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
        </>
      }
      data-testid="unexpected-error-page"
    />
  );
}
