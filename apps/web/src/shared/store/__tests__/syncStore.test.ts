import { afterEach, describe, expect, it, vi } from 'vitest';

import { createChannel } from '@/shared/channel';

import { create } from '../create';
import { syncStore } from '../syncStore';

interface PrefStore {
  locale: string;
  draft: string;
  setLocale: (locale: string) => void;
}

const hasBroadcastChannel = typeof BroadcastChannel !== 'undefined';
const stops: (() => void)[] = [];

/** 每次呼叫代表一個分頁裡的同一個 store。 */
function openTab() {
  const store = create<PrefStore>((set) => ({
    locale: 'en_US',
    draft: '',
    setLocale: (locale) => set({ locale }),
  }));
  stops.push(syncStore(store, ['locale'], createChannel('store:test-pref')));
  return store;
}

afterEach(() => {
  for (const stop of stops.splice(0)) stop();
});

describe.runIf(hasBroadcastChannel)('syncStore（store 同步，預設走 BroadcastChannel）', () => {
  it('一個分頁改了同步欄位，其他分頁跟著更新', async () => {
    const [a, b, c] = [openTab(), openTab(), openTab()];

    a.getState().setLocale('zh_TW');

    await vi.waitFor(() => {
      expect(b.getState().locale).toBe('zh_TW');
      expect(c.getState().locale).toBe('zh_TW');
    });
  });

  it('不在 keys 裡的欄位不同步', async () => {
    const [a, b] = [openTab(), openTab()];

    a.setState({ draft: 'local only' });
    a.setState({ locale: 'zh_TW' });

    await vi.waitFor(() => expect(b.getState().locale).toBe('zh_TW'));
    expect(b.getState().draft).toBe('');
  });

  it('收到的更新不再廣播回去（不會迴圈）', async () => {
    const [a, b] = [openTab(), openTab()];
    const onA = vi.fn();
    a.subscribe(onA);

    a.getState().setLocale('zh_TW');
    await vi.waitFor(() => expect(b.getState().locale).toBe('zh_TW'));
    await new Promise((resolve) => setTimeout(resolve, 20));

    // 只有自己那一次 setState；b 沒有把收到的值再廣播回來
    expect(onA).toHaveBeenCalledTimes(1);
  });

  it('停止同步後不再收發', async () => {
    const [a, b, c] = [openTab(), openTab(), openTab()];
    stops[1]?.();

    a.getState().setLocale('zh_TW');

    await vi.waitFor(() => expect(c.getState().locale).toBe('zh_TW'));
    expect(b.getState().locale).toBe('en_US');
  });
});
