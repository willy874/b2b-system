import { Skeleton } from '@/components/Skeleton';

/** 權限還沒水合時顯示，避免先閃 403 再閃內容。 */
export function PageSkeleton() {
  return (
    <div className="flex flex-col gap-4 p-6" data-testid="page-skeleton">
      <Skeleton width={220} height={28} />
      <Skeleton height={40} />
      <Skeleton height={240} />
    </div>
  );
}
