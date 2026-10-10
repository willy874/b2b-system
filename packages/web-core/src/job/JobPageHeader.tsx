import { PageHeader } from '@b2b-system/ui/PageHeader';
export interface JobPageHeaderProps {
  title: string;
  description: string;
}

/** 背景工作頁的標題列（兩個 app 共用）：標題與說明。佇列概況在下方的分頁（`JobPageTabs`）。 */
export function JobPageHeader({ title, description }: JobPageHeaderProps) {
  return <PageHeader title={title} description={description} />;
}
