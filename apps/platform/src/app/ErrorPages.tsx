import { Spinner } from '@b2b-system/ui/Spinner';
import {
  ForbiddenPage as CoreForbiddenPage,
  NotFoundPage as CoreNotFoundPage,
  RouteErrorPage as CoreRouteErrorPage,
  UnexpectedErrorPage as CoreUnexpectedErrorPage,
} from '@b2b-system/web-core/components';
import type {
  RouteErrorPageProps,
  UnexpectedErrorPageProps,
} from '@b2b-system/web-core/components';
import { useTranslation } from '@b2b-system/web-core/locales';

/*
 * 錯誤頁本身在 web-core（與 backstage 共用）；apps/platform 用 `compact` 版面（靠左、字級與內文相近），
 * 載入中是 spinner（backstage 是骨架屏）。
 */

export function ForbiddenPage() {
  return <CoreForbiddenPage variant="compact" />;
}

export function NotFoundPage() {
  return <CoreNotFoundPage variant="compact" />;
}

export function UnexpectedErrorPage(props: Omit<UnexpectedErrorPageProps, 'variant'>) {
  return <CoreUnexpectedErrorPage {...props} variant="compact" />;
}

export function RouteErrorPage(props: Omit<RouteErrorPageProps, 'variant'>) {
  return <CoreRouteErrorPage {...props} variant="compact" />;
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
