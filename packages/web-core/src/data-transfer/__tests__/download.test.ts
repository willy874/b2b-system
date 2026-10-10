import { afterEach, describe, expect, it, vi } from 'vitest';

import { downloadFromUrl, downloadSequentially } from '../download';

describe('downloadFromUrl', () => {
  afterEach(() => vi.restoreAllMocks());

  it('anchor 掛進 DOM 點擊後移除', () => {
    const seen: Array<{ connected: boolean; href: string; download: string }> = [];
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      seen.push({ connected: this.isConnected, href: this.href, download: this.download });
    });

    downloadFromUrl('http://s/a', 'a.txt');

    expect(seen).toEqual([{ connected: true, href: 'http://s/a', download: 'a.txt' }]);
    expect(document.querySelector('a')).toBeNull();
  });
});

describe('downloadSequentially（依序觸發多個下載）', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  function spyClicks() {
    const hrefs: string[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      hrefs.push(this.href);
    });
    return hrefs;
  }

  it('每個之間隔 intervalMs，略過 resolve 回 undefined 的項目', async () => {
    vi.useFakeTimers();
    const hrefs = spyClicks();

    const done = downloadSequentially(['a', 'skip', 'b'], {
      intervalMs: 100,
      resolve: (id) => (id === 'skip' ? undefined : { url: `http://s/${id}`, fileName: id }),
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(hrefs).toEqual(['http://s/a']);
    await vi.advanceTimersByTimeAsync(99);
    expect(hrefs).toEqual(['http://s/a']);
    await vi.advanceTimersByTimeAsync(1);
    await done;
    expect(hrefs).toEqual(['http://s/a', 'http://s/b']);
  });

  it('超過上限只觸發前 max 個並呼叫一次 onLimited', async () => {
    const hrefs = spyClicks();
    const onLimited = vi.fn();
    const resolve = vi.fn(async (id: string) => ({ url: `http://s/${id}`, fileName: '' }));

    await downloadSequentially(['a', 'b', 'c'], { max: 2, intervalMs: 0, resolve, onLimited });

    expect(hrefs).toEqual(['http://s/a', 'http://s/b']);
    expect(resolve).toHaveBeenCalledTimes(2);
    expect(onLimited).toHaveBeenCalledOnce();
    expect(onLimited).toHaveBeenCalledWith(2);
  });

  it('沒超過上限不呼叫 onLimited', async () => {
    spyClicks();
    const onLimited = vi.fn();
    await downloadSequentially(['a'], {
      intervalMs: 0,
      resolve: (id) => ({ url: `http://s/${id}`, fileName: '' }),
      onLimited,
    });
    expect(onLimited).not.toHaveBeenCalled();
  });
});
