import { act } from '@testing-library/react';
import { vi } from 'vitest';

type Metric = 'clientWidth' | 'scrollWidth' | 'clientHeight' | 'scrollHeight' | 'width';

/**
 * jsdom 沒有布局：以 `data-testid` 指定元素的尺寸，並手動觸發 `ResizeObserver`。
 *
 * - `clientWidth` / `scrollWidth` / `clientHeight` / `scrollHeight` 只看元素本身的 testid。
 * - `getBoundingClientRect().width` 找不到自己的 testid 時，沿第一個子元素往下找
 *   （包在外層的 wrapper 會拿到內容的寬度）。
 */
export function installFakeLayout() {
  const sizes = new Map<string, Partial<Record<Metric, number>>>();
  const observers = new Set<() => void>();

  const sizeOf = (element: Element, metric: Metric) =>
    sizes.get(element.getAttribute('data-testid') ?? '')?.[metric];

  for (const metric of ['clientWidth', 'scrollWidth', 'clientHeight', 'scrollHeight'] as const) {
    vi.spyOn(HTMLElement.prototype, metric, 'get').mockImplementation(function (this: HTMLElement) {
      return sizeOf(this, metric) ?? 0;
    });
  }
  const widthOf = (element: Element | null): number => {
    if (!element) return 0;
    return sizeOf(element, 'width') ?? widthOf(element.firstElementChild);
  };
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
    this: HTMLElement,
  ) {
    return DOMRect.fromRect({ width: widthOf(this), height: 0 });
  });
  vi.stubGlobal(
    'ResizeObserver',
    class {
      private readonly notify: () => void;
      constructor(callback: () => void) {
        this.notify = () => callback();
      }
      observe() {
        observers.add(this.notify);
      }
      unobserve() {}
      disconnect() {
        observers.delete(this.notify);
      }
    },
  );

  return {
    setSize(testId: string, size: Partial<Record<Metric, number>>) {
      sizes.set(testId, { ...sizes.get(testId), ...size });
    },
    /** 觸發所有 ResizeObserver（改完尺寸後呼叫）。 */
    resize() {
      act(() => {
        for (const notify of observers) notify();
      });
    },
    restore() {
      sizes.clear();
      observers.clear();
      vi.restoreAllMocks();
      vi.unstubAllGlobals();
    },
  };
}
