import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { MouseEvent } from 'react';

import type { MarqueeMode } from '@/core/selection';
import type { GalleryItem } from '@/shared/api-sdk';

/**
 * 多選（docs/architecture/frontend/24-gallery.md §5）：點選框、Shift 連續選取（依已載入的順序）、框選、以區段為單位全選。
 * 選到的 id 不在已載入的列表裡（被刪除、換了篩選）就自然不算進數量。
 */
export function useGallerySelection(items: readonly GalleryItem[]) {
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const anchor = useRef<string | undefined>(undefined);
  const latest = useRef(selected);
  useLayoutEffect(() => {
    latest.current = selected;
  });

  const visible = useMemo(() => {
    const ids = new Set(items.map((item) => item.id));
    return new Set([...selected].filter((id) => ids.has(id)));
  }, [items, selected]);

  const toggle = useCallback(
    (item: GalleryItem, event?: Pick<MouseEvent, 'shiftKey'>) => {
      setSelected((current) => {
        const next = new Set(current);
        if (event?.shiftKey && anchor.current) {
          const from = items.findIndex((entry) => entry.id === anchor.current);
          const to = items.findIndex((entry) => entry.id === item.id);
          if (from >= 0 && to >= 0) {
            const [start, end] = from < to ? [from, to] : [to, from];
            for (const entry of items.slice(start, end + 1)) next.add(entry.id);
            return next;
          }
        }
        if (next.has(item.id)) next.delete(item.id);
        else next.add(item.id);
        anchor.current = item.id;
        return next;
      });
    },
    [items],
  );

  const apply = useCallback(
    (ids: readonly string[], mode: MarqueeMode, base: ReadonlySet<string>) => {
      setSelected(mode === 'add' ? new Set([...base, ...ids]) : new Set(ids));
    },
    [],
  );

  const addAll = useCallback((ids: readonly string[]) => {
    setSelected((current) => new Set([...current, ...ids]));
  }, []);

  const clear = useCallback(() => {
    anchor.current = undefined;
    setSelected(new Set());
  }, []);

  const getSelected = useCallback(() => latest.current, []);

  return { selected: visible, toggle, apply, addAll, clear, getSelected };
}
