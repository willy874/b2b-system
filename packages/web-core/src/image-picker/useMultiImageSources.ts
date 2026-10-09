import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';

import { usePermission } from '../permission';
import { resolveAvailableSources } from './availability';
import { UPLOAD_IMAGE_SOURCE, useImageSources } from './registry';
import type { ImageSourceDefinition, ImageUsage } from './types';

/**
 * 多選模式一律不列的來源：「上傳」是呼叫端自己的入口；「最近使用」是選過的圖片資產，
 * 拿來「從其他來源加入」等於把同一張再複製一次（app 登記的 id，見 `apps/backstage/src/app/image-picker/register.ts`）。
 */
const NEVER_MULTIPLE: ReadonlySet<string> = new Set([UPLOAD_IMAGE_SOURCE, 'recent']);

/** 支援多選、沒被排除的來源（還沒判斷權限與用途）。 */
function multipleCandidates(
  sources: readonly ImageSourceDefinition[],
  exclude: ReadonlySet<string>,
): ImageSourceDefinition[] {
  return sources.filter(
    (source) =>
      source.supportsMultiple === true && !NEVER_MULTIPLE.has(source.id) && !exclude.has(source.id),
  );
}

/**
 * 多選模式可用的來源（docs/architecture/frontend/23-image-picker.md §2.1）：支援多選、用途允許、`isAvailable` 為真、不在 `exclude`。
 * 還在判斷（或還不知道用途）時是 undefined。
 */
export function useMultiImageSources(
  usage: ImageUsage | undefined,
  exclude: readonly string[] = [],
): ImageSourceDefinition[] | undefined {
  const registered = useImageSources();
  const queryClient = useQueryClient();
  const { can } = usePermission();
  const [resolved, setResolved] = useState<{
    candidates: readonly ImageSourceDefinition[];
    usage: ImageUsage;
    sources: ImageSourceDefinition[];
  }>();
  // 呼叫端常直接傳陣列字面量：以內容比較，才不會每次 render 都重新判斷
  const excludeKey = exclude.join('\n');
  const candidates = useMemo(
    () => multipleCandidates(registered, new Set(excludeKey ? excludeKey.split('\n') : [])),
    [registered, excludeKey],
  );

  useEffect(() => {
    if (!usage) return;
    let isCurrent = true;
    void resolveAvailableSources(candidates, { usage, can, queryClient }).then((sources) => {
      if (isCurrent) setResolved({ candidates, usage, sources });
    });
    return () => {
      isCurrent = false;
    };
  }, [candidates, usage, can, queryClient]);

  // 換了用途或註冊表之後，舊的結果不算數（等新的判斷完）
  if (!usage || resolved?.usage !== usage || resolved.candidates !== candidates) return undefined;
  return resolved.sources;
}

/**
 * 有沒有任何來源能在多選模式使用：呼叫端以它決定要不要顯示「從其他來源…」（docs/architecture/frontend/23-image-picker.md §2.1）。
 * 還在判斷時是 undefined（先不顯示，避免選單項目閃一下又消失）。
 */
export function useMultiImageSourcesAvailable(
  usage: ImageUsage | undefined,
  exclude?: readonly string[],
): boolean | undefined {
  const sources = useMultiImageSources(usage, exclude);
  return sources === undefined ? undefined : sources.length > 0;
}
