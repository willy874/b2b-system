import type { GridLayout } from '@b2b-system/ui/JustifiedGrid';
import { hitTestGrid } from '@b2b-system/ui/JustifiedGrid';
import { useTranslation } from '@b2b-system/web-core/locales';
import { useCallback, useMemo, useRef, useState } from 'react';

import { useMarqueeSelection } from '@/core/selection';
import type { GalleryItem } from '@/shared/api-sdk';

import type { GalleryGrouping } from './preference';
import type { GallerySection } from './sections';
import { useGallerySelection } from './useGallerySelection';

/** 格子的捲動容器、版面（框選以它算命中）、目前的區段、區段標題的格式與多選。 */
export function useGalleryGridState(items: readonly GalleryItem[], grouping: GalleryGrouping) {
  const { language } = useTranslation();
  const [scrollElement, setScrollElement] = useState<HTMLDivElement | null>(null);
  const layoutRef = useRef<GridLayout | undefined>(undefined);
  const [activeSection, setActiveSection] = useState<string>();
  const selection = useGallerySelection(items);
  const marquee = useMarqueeSelection({
    scrollElement,
    enabled: items.length > 0,
    hitTest: (rect) => (layoutRef.current ? hitTestGrid(layoutRef.current, rect) : []),
    getSelected: selection.getSelected,
    apply: selection.apply,
    clear: selection.clear,
  });

  const dayFormat = useMemo(
    () =>
      new Intl.DateTimeFormat(language, {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        weekday: 'short',
      }),
    [language],
  );
  const monthFormat = useMemo(
    () => new Intl.DateTimeFormat(language, { year: 'numeric', month: 'long' }),
    [language],
  );
  const labelOf = useCallback(
    (section: GallerySection) => {
      if (!section.date) return undefined;
      return grouping === 'month'
        ? monthFormat.format(section.date)
        : dayFormat.format(section.date);
    },
    [dayFormat, monthFormat, grouping],
  );

  const onLayoutChange = useCallback((layout: GridLayout) => {
    layoutRef.current = layout;
  }, []);

  return {
    scrollElement,
    setScrollElement,
    onLayoutChange,
    activeSection,
    setActiveSection,
    selection,
    marquee,
    labelOf,
  };
}
