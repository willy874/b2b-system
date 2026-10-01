import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

// jsdom 26 沒有 PointerEvent；Base UI 1.x 的 Checkbox / Switch 等以 `new PointerEvent('click')` 重送點擊
// （utils/dispatchClickWithModifiers），缺了會在點擊時拋 TypeError。瀏覽器都有，只在測試環境補上
if (typeof window.PointerEvent === 'undefined') {
  class PointerEventPolyfill extends MouseEvent {
    readonly pointerId: number;
    readonly pointerType: string;

    constructor(type: string, init: PointerEventInit = {}) {
      super(type, init);
      this.pointerId = init.pointerId ?? 0;
      this.pointerType = init.pointerType ?? '';
    }
  }
  window.PointerEvent = PointerEventPolyfill as typeof PointerEvent;
}

afterEach(() => {
  cleanup();
});
