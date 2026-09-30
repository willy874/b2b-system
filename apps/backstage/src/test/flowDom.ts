import { vi } from 'vitest';

/**
 * jsdom 沒有布局：React Flow（`TreeEditor`）需要 ResizeObserver、DOMMatrixReadOnly（讀縮放比例）與 SVG 的 getBBox。
 * 替身照 React Flow 官方的測試說明（reactflow.dev/learn/advanced-use/testing）。在 `beforeAll` 呼叫。
 */
export function installFlowDom(): void {
  vi.stubGlobal(
    'ResizeObserver',
    // 尺寸由下面的 offsetWidth / offsetHeight 提供，不需要真的通知
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  vi.stubGlobal(
    'DOMMatrixReadOnly',
    class {
      m22: number;
      constructor(transform?: string) {
        const scale = transform?.match(/scale\(([\d.]+)\)/)?.[1];
        this.m22 = scale === undefined ? 1 : Number(scale);
      }
    },
  );
  vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockImplementation(function (
    this: HTMLElement,
  ) {
    return Number.parseFloat(this.style.width) || 800;
  });
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(function (
    this: HTMLElement,
  ) {
    return Number.parseFloat(this.style.height) || 600;
  });
  Object.defineProperty(SVGElement.prototype, 'getBBox', {
    configurable: true,
    value: () => ({ x: 0, y: 0, width: 0, height: 0 }),
  });
}
