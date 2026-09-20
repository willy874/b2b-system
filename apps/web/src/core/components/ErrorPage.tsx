import type { ReactNode } from 'react';

import { Button } from '@/components/Button';
import { useTranslation } from '@/core/locales';

import './ErrorPage.css';

export interface ErrorPageProps {
  code: string;
  title: string;
  description?: string;
  action?: ReactNode;
  'data-testid'?: string;
}

export function ErrorPage({ code, title, description, action, ...rest }: ErrorPageProps) {
  return (
    <div className="ge-error-page" {...rest}>
      <p className="ge-error-page__code">{code}</p>
      <h1 className="ge-error-page__title">{title}</h1>
      {description && <p className="ge-error-page__description">{description}</p>}
      {action && <div className="ge-error-page__action">{action}</div>}
    </div>
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
      data-testid="forbidden-page"
    />
  );
}

export function NotFoundPage() {
  const { t } = useTranslation();
  return (
    <ErrorPage
      code="404"
      title={t('error.page.notFound.title')}
      description={t('error.page.notFound.description')}
      data-testid="not-found-page"
    />
  );
}

export function UnexpectedErrorPage({ onRetry }: { onRetry?: () => void }) {
  const { t } = useTranslation();
  return (
    <ErrorPage
      code="500"
      title={t('error.page.unexpected.title')}
      description={t('error.page.unexpected.description')}
      action={
        onRetry && (
          <Button variant="primary" onClick={onRetry}>
            {t('common.retry')}
          </Button>
        )
      }
      data-testid="unexpected-error-page"
    />
  );
}
