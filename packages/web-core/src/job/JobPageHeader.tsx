export interface JobPageHeaderProps {
  title: string;
  description: string;
}

/** 背景工作頁的標題列（兩個 app 共用）：標題與說明。佇列概況在下方的分頁（`JobPageTabs`）。 */
export function JobPageHeader({ title, description }: JobPageHeaderProps) {
  return (
    <header>
      <h1 className="m-0 text-xl font-semibold">{title}</h1>
      <p className="mt-1 text-sm text-[var(--color-fg-muted)]">{description}</p>
    </header>
  );
}
