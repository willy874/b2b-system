import { useRouter } from '@tanstack/react-router';
import type { ErrorComponentProps } from '@tanstack/react-router';
import type { ReactNode } from 'react';

import { Button } from '@/components/Button';
import { Spinner } from '@/components/Spinner';
import { useTranslation } from '@/core/locales';

/**
 * 部署新版後，舊分頁 lazy 載入的舊 chunk 已經不在伺服器上。各瀏覽器的訊息不同：
 * Chrome「Failed to fetch dynamically imported module」、Firefox「error loading dynamically imported module」、
 * Safari「Importing a module script failed」；Vite 的 preload 失敗則是「Unable to preload CSS」。
 */
const CHUNK_ERROR_PATTERN =
  /Failed to fetch dynamically imported module|error loading dynamically imported module|Importing a module script failed|Unable to preload CSS/i;

export function isChunkLoadError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return error.name === 'ChunkLoadError' || CHUNK_ERROR_PATTERN.test(error.message);
}

interface ErrorLayoutProps {
  code?: string;
  title: string;
  description: string;
  actions: ReactNode;
  'data-testid': string;
}

function ErrorLayout({ code, title, description, actions, ...rest }: ErrorLayoutProps) {
  return (
    <div className="flex flex-col items-start gap-2 p-6" {...rest}>
      {code && <p className="m-0 text-sm font-semibold text-[var(--color-fg-muted)]">{code}</p>}
      <h1 className="m-0 text-lg font-semibold">{title}</h1>
      <p className="m-0 text-sm text-[var(--color-fg-muted)]">{description}</p>
      <div className="mt-2 flex flex-wrap gap-2">{actions}</div>
    </div>
  );
}

/** 「回首頁」與「返回上一頁」：停在錯誤頁時不必靠網址列離開。 */
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
    <ErrorLayout
      code="403"
      title={t('error.page.forbidden.title')}
      description={t('error.page.forbidden.description')}
      actions={<LeaveActions />}
      data-testid="forbidden-page"
    />
  );
}

/** 未知網址（打錯、書籤指向舊路由）：router 的 `defaultNotFoundComponent`。 */
export function NotFoundPage() {
  const { t } = useTranslation();
  return (
    <ErrorLayout
      code="404"
      title={t('error.page.notFound.title')}
      description={t('error.page.notFound.description')}
      actions={<LeaveActions />}
      data-testid="not-found-page"
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
      <ErrorLayout
        title={t('error.page.updated.title')}
        description={t('error.page.updated.description')}
        actions={
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
    <ErrorLayout
      title={t('error.page.unexpected.title')}
      description={t('error.page.unexpected.description')}
      actions={
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

/** 頁面程式碼或權限載入中：給視覺回饋，不要一整片空白看起來像當掉。 */
export function PageFallback() {
  const { t } = useTranslation();
  return (
    <div className="flex justify-center p-10" aria-busy="true" data-testid="page-fallback">
      <Spinner size={24} label={t('common.loading')} />
    </div>
  );
}

/** 交給 `createRouter()` 的預設載入中、404 與錯誤頁（app/plugin.ts）。 */
export const ROUTER_DEFAULT_COMPONENTS = {
  defaultPendingComponent: PageFallback,
  defaultNotFoundComponent: NotFoundPage,
  defaultErrorComponent: RouteErrorPage,
} as const;
