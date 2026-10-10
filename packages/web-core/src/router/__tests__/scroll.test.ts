import { afterEach, describe, expect, it } from 'vitest';

import { APP_CONTENT_SCROLL_ID, scrollRestorationOptions } from '../scroll';

afterEach(() => document.body.replaceChildren());

describe('捲動還原的設定（換頁回到頂端、返回時還原）', () => {
  it('開啟 scrollRestoration；回到頂端的對象含 window 與外框的 <main>', () => {
    const main = document.createElement('main');
    main.dataset.scrollRestorationId = APP_CONTENT_SCROLL_ID;
    document.body.append(main);

    expect(scrollRestorationOptions.scrollRestoration).toBe(true);
    const [first, content] = scrollRestorationOptions.scrollToTopSelectors;
    expect(first).toBe('window');
    expect(typeof content === 'function' ? content() : undefined).toBe(main);
  });
});
