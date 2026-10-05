import type { ChannelTransportFactory } from '../channel';

interface Endpoint {
  listeners: Set<(message: unknown) => void>;
  isolated: boolean;
}

/**
 * 模擬同源分頁之間的 BroadcastChannel：每個 `transport()` 代表一個分頁的一端，
 * 同一端可以開多個頻道（`createChannel` 以頻道名稱分流）。
 * 送達走 `setTimeout(latency)`，搭配 `vi.useFakeTimers()` 就能決定「誰在什麼時候收到」。
 *
 * - `isolate(transport)`：這一端從此收發都斷開，模擬分頁當掉或被系統凍結（不會送出任何告別訊息）。
 * - `sent`：依序記錄所有送出的訊息（外框），用來斷言某種訊息有沒有送出。
 */
export function createFakeChannelHub({ latency = 0 }: { latency?: number } = {}) {
  const endpoints = new Map<ChannelTransportFactory, Endpoint>();
  const sent: unknown[] = [];

  function transport(): ChannelTransportFactory {
    const endpoint: Endpoint = { listeners: new Set(), isolated: false };
    const factory: ChannelTransportFactory = () => {
      let own: ((message: unknown) => void) | undefined;
      return {
        post(message) {
          if (endpoint.isolated) return;
          sent.push(message);
          for (const other of endpoints.values()) {
            if (other === endpoint) continue;
            setTimeout(() => {
              if (other.isolated) return;
              for (const listener of Array.from(other.listeners)) listener(message);
            }, latency);
          }
        },
        subscribe(listener) {
          own = listener;
          endpoint.listeners.add(listener);
          return () => endpoint.listeners.delete(listener);
        },
        close() {
          if (own) endpoint.listeners.delete(own);
        },
      };
    };
    endpoints.set(factory, endpoint);
    return factory;
  }

  function isolate(factory: ChannelTransportFactory): void {
    const endpoint = endpoints.get(factory);
    if (endpoint) endpoint.isolated = true;
  }

  /** 送出過的某種訊息（依外框的 `type`）。 */
  function sentOfType(type: string): unknown[] {
    return sent.filter((message) => (message as { type?: unknown }).type === type);
  }

  return { transport, isolate, sent, sentOfType };
}
