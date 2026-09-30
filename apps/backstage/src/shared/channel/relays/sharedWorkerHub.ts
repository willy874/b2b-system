import { isChannelEnvelope } from '../envelope';

/** 分頁關閉前送給 hub 的訊息：把自己的 port 從轉發名單移除。 */
export const CHANNEL_HUB_BYE = { tag: 'ge-channel-hub', type: 'bye' } as const;

/** SharedWorker 的 global scope 中 hub 用得到的部分（專案的 tsconfig 沒有 WebWorker lib）。 */
export interface SharedWorkerScopeLike {
  addEventListener(
    type: 'connect',
    listener: (event: { ports: readonly MessagePort[] }) => void,
  ): void;
}

function isBye(value: unknown): boolean {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { tag?: unknown }).tag === CHANNEL_HUB_BYE.tag &&
    (value as { type?: unknown }).type === CHANNEL_HUB_BYE.type
  );
}

/** 在 SharedWorker 裡呼叫：把任一分頁送來的頻道訊息轉給其他所有分頁。 */
export function startChannelHub(scope: SharedWorkerScopeLike): void {
  const ports = new Set<MessagePort>();
  scope.addEventListener('connect', (event) => {
    const port = event.ports[0];
    if (!port) return;
    ports.add(port);
    port.addEventListener('message', (message: MessageEvent) => {
      if (isBye(message.data)) {
        ports.delete(port);
        port.close();
        return;
      }
      if (!isChannelEnvelope(message.data)) return;
      // oxlint-disable-next-line unicorn/require-post-message-target-origin -- MessagePort 沒有 targetOrigin
      for (const other of ports) if (other !== port) other.postMessage(message.data);
    });
    port.start();
  });
}
