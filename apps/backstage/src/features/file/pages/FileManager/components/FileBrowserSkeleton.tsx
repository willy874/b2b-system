import { Skeleton } from '@b2b-system/ui/Skeleton';

import type { FileViewMode } from '../../../preference';

/** 第一頁載入中：依排版顯示卡片或列的骨架。 */
export function FileBrowserSkeleton({ viewMode }: { viewMode: FileViewMode }) {
  return viewMode === 'grid' ? (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(10rem,1fr))] gap-3 p-3" aria-hidden>
      {Array.from({ length: 12 }, (_, index) => (
        <Skeleton key={index} height="11rem" />
      ))}
    </div>
  ) : (
    <div className="flex flex-col gap-2 p-3" aria-hidden>
      {Array.from({ length: 10 }, (_, index) => (
        <Skeleton key={index} height="2.25rem" />
      ))}
    </div>
  );
}
