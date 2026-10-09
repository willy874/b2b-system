import { useLayoutEffect, useState } from 'react';

export interface ElementSize {
  width: number;
  height: number;
}

const ZERO: ElementSize = { width: 0, height: 0 };

/**
 * 量元素的 `clientWidth` / `clientHeight`（不含捲軸），尺寸改變時更新。
 * 沒有 `ResizeObserver` 的環境（jsdom）只在掛上時量一次。
 */
export function useElementSize(element: HTMLElement | null): ElementSize {
  const [size, setSize] = useState<ElementSize>(ZERO);
  useLayoutEffect(() => {
    if (!element) return undefined;
    const measure = () => {
      const width = element.clientWidth;
      const height = element.clientHeight;
      setSize((previous) =>
        previous.width === width && previous.height === height ? previous : { width, height },
      );
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [element]);
  return size;
}
