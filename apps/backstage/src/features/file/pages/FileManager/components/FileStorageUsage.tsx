import { Progress } from '@b2b-system/ui/Progress';
import { useTranslation } from '@b2b-system/web-core/locales';
import { formatBytes } from '@b2b-system/web-shared/utils';
import { useQuery } from '@tanstack/react-query';

import { getFileStorageUsageQueryOptions } from '@/apis/file/get-upload-policy/query';

/** 用到九成以上改成警示色：提醒在上傳失敗之前整理檔案。 */
const NEARLY_FULL = 0.9;

/**
 * 租戶的檔案容量與已用量（docs/architecture/05-tenancy.md §13.3 D8）：含上傳中與回收桶裡的檔案，
 * 容量由平台管理者設定。載入前或失敗時不顯示（不影響檔案管理）。
 */
export function FileStorageUsage() {
  const { t } = useTranslation();
  const { data } = useQuery(getFileStorageUsageQueryOptions());
  if (!data) return null;
  const ratio = data.quota > 0 ? data.used / data.quota : 1;
  return (
    <Progress
      // 畫面太矮、改由外框的主內容捲動時貼在視窗底邊：bottom 抵銷主內容的內距（DashboardShell 的 .content），
      // 否則內距那一段會露出捲到後面的資料夾樹
      className="sticky bottom-[calc(-1*var(--seed-space-6))] shrink-0 rounded-b-lg border-t border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2"
      value={Math.min(data.used, data.quota)}
      max={data.quota}
      tone={ratio >= NEARLY_FULL ? 'danger' : 'brand'}
      label={t('file.storage.usage', {
        used: formatBytes(data.used),
        quota: formatBytes(data.quota),
      })}
      data-testid="file-storage-usage"
    />
  );
}
