import type { ReactNode } from 'react';

export interface AuthShellProps {
  /** 卡片最上方的產品名（各 app 的 `app.title`）。 */
  brand: string;
  title: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
}

/** 登入、SSO 回呼、帳號流程等不套外框的頁面：畫面正中央的一張卡片。 */
export function AuthShell({ brand, title, description, children, footer }: AuthShellProps) {
  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <div className="w-full max-w-sm rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface)] p-6 shadow-sm">
        <p className="m-0 text-xs font-semibold tracking-wide text-[var(--color-brand)]">{brand}</p>
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
