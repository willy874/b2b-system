import type { QueryClient } from '@tanstack/react-query';

import type { ImageSourceContext, ImageSourceDefinition, ImageUsage } from './types';

/** 非同步的判斷最多等多久（毫秒）；逾時當作不可用。 */
export const IMAGE_SOURCE_AVAILABILITY_TIMEOUT_MS = 1000;
/** 判斷結果快取多久（毫秒）：滑過時預先抓，按下時通常已經有答案。 */
const AVAILABILITY_STALE_MS = 60_000;

export const IMAGE_SOURCE_AVAILABILITY_QUERY_KEY = 'IMAGE_SOURCE_AVAILABILITY_QUERY_KEY';

function withTimeout(promise: Promise<boolean>, ms: number): Promise<boolean> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      () => {
        clearTimeout(timer);
        resolve(false);
      },
    );
  });
}

/** 用途允許這個來源（`sources` 是 null 時全部允許）。 */
export function usageAllows(usage: ImageUsage, sourceId: string): boolean {
  return usage.sources === null || usage.sources.includes(sourceId);
}

/**
 * 依序判斷每個來源（docs/architecture/frontend/23-image-picker.md §2）：用途允許、`isAvailable` 為真。
 * 非同步的判斷以 React Query 快取 1 分鐘、最多等 1 秒；失敗或逾時當作不可用。
 */
export async function resolveAvailableSources(
  sources: readonly ImageSourceDefinition[],
  context: ImageSourceContext,
): Promise<ImageSourceDefinition[]> {
  const results = await Promise.all(
    sources.map(async (source) => {
      if (!usageAllows(context.usage, source.id)) return false;
      if (!source.isAvailable) return true;
      return isAvailableCached(source, context);
    }),
  );
  return sources.filter((_source, index) => results[index]);
}

function isAvailableCached(
  source: ImageSourceDefinition,
  context: ImageSourceContext,
): boolean | Promise<boolean> {
  const result = source.isAvailable?.(context) ?? true;
  // 權限之類的同步判斷每次都重算（權限會變）；只有「有沒有內容」這種要打 api 的才快取
  if (typeof result === 'boolean') return result;
  return context.queryClient.fetchQuery({
    queryKey: [IMAGE_SOURCE_AVAILABILITY_QUERY_KEY, source.id, context.usage.id],
    staleTime: AVAILABILITY_STALE_MS,
    queryFn: () => withTimeout(result, IMAGE_SOURCE_AVAILABILITY_TIMEOUT_MS),
  });
}

/** 選好一張圖之後呼叫：「最近使用」這類依內容判斷的來源要重新判斷。 */
export function invalidateSourceAvailability(queryClient: QueryClient): Promise<void> {
  return queryClient.invalidateQueries({ queryKey: [IMAGE_SOURCE_AVAILABILITY_QUERY_KEY] });
}
