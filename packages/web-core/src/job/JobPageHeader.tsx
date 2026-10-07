import { JobQueueDialog } from './JobQueueDialog';
import type { JobQueueDialogProps } from './JobQueueDialog';

export interface JobPageHeaderProps extends JobQueueDialogProps {
  title: string;
  description: string;
}

/** 背景工作頁的標題列（兩個 app 共用）：標題、說明，右側是「佇列概況」對話框的按鈕。 */
export function JobPageHeader({ title, description, ...queue }: JobPageHeaderProps) {
  return (
    <header className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h1 className="m-0 text-xl font-semibold">{title}</h1>
        <p className="mt-1 text-sm text-[var(--color-fg-muted)]">{description}</p>
      </div>
      <JobQueueDialog {...queue} />
    </header>
  );
}
