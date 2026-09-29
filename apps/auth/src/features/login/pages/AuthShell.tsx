import type { ReactNode } from 'react';

import { useTranslation } from '@/core/locales';

export interface AuthShellProps {
  title: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
}

export function AuthShell({ title, description, children, footer }: AuthShellProps) {
  const { t } = useTranslation();
  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <div className="w-full max-w-sm rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface)] p-6 shadow-sm">
        <p className="m-0 text-xs font-semibold tracking-wide text-[var(--color-brand)]">
          {t('app.title')}
        </p>
        <h1 className="mt-1 mb-1 text-xl font-semibold">{title}</h1>
        {description && (
          <p className="mt-0 mb-4 text-sm text-[var(--color-fg-muted)]">{description}</p>
        )}
        {children}
        {footer && <div className="mt-4 text-sm">{footer}</div>}
      </div>
    </div>
  );
}
