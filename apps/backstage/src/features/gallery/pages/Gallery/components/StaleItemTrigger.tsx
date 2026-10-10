import { useLatestRef } from '@b2b-system/ui/useLatestRef';
import { useEffect } from 'react';

interface StaleItemTriggerProps {
  id: string;
  /** 每次資料改變都換一個值：取回一頁之後仍在畫面上的快照再通知一次。 */
  revision: unknown;
  onVisible: (id: string) => void;
}

/**
 * 放在快照項目的格子或列裡（docs/architecture/frontend/24-gallery.md §3）：虛擬捲動只渲染畫面附近的項目，
 * 掛上就代表捲到了被 `maxPages` 丟掉的頁，通知重新取那一頁。本身不渲染任何東西。
 */
export function StaleItemTrigger({ id, revision, onVisible }: StaleItemTriggerProps) {
  const onVisibleRef = useLatestRef(onVisible);
  useEffect(() => {
    onVisibleRef.current(id);
    // oxlint-disable-next-line react/exhaustive-effect-dependencies -- revision 是刻意的觸發條件：取回一頁之後還在畫面上的快照再通知一次
  }, [id, revision, onVisibleRef]);
  return null;
}
