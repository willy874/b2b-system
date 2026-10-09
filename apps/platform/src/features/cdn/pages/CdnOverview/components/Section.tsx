import type { ReactNode } from 'react';

interface SectionProps {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  'data-testid'?: string;
}

/** CDN 頁面的一個區塊（卡片＋標題列）。 */
export function Section({ title, description, actions, children, ...rest }: SectionProps) {
  return (
    <section
      className="flex flex-col gap-3 rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface)] p-4"
      data-testid={rest['data-testid']}
    >
      <header className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex flex-col gap-1">
          <h2 className="m-0 text-base font-medium">{title}</h2>
          {description && <p className="m-0 text-sm text-[var(--color-fg-muted)]">{description}</p>}
        </div>
        {actions}
      </header>
      {children}
    </section>
  );
}
