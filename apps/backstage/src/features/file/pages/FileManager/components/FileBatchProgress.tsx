import {
  BatchProgressBar,
  isBatchJobActive,
  useBatchJobs,
  useBatchQueue,
} from '@b2b-system/web-core/batch';

import { FILE_MANAGER_SCOPE } from '../../../batch';

/**
 * 檔案管理器送出的批次工作（上傳、多筆刪除）進行中時的進度條。
 *
 * 自己訂閱佇列：佇列每次進度都廣播一份快照（上傳時每秒數次），訂閱放在頁面層會讓整個檔案管理器
 * （工具列、資料夾樹、主區塊）跟著每個快照重繪；放在這裡只有進度條重繪。
 */
export function FileBatchProgress() {
  const queue = useBatchQueue();
  const jobs = useBatchJobs();
  const active = jobs.filter((job) => job.scope === FILE_MANAGER_SCOPE && isBatchJobActive(job));
  if (!queue || active.length === 0) return null;
  return <BatchProgressBar jobs={active} onCancel={(jobId) => queue.cancel(jobId)} />;
}
