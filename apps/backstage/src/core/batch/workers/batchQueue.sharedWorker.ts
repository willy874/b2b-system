import { BatchQueueHost } from '../BatchQueueHost';
import type { BatchPort } from '../protocol';

// tsconfig 只有 DOM lib，self 被型別成 Window；執行期這裡是 SharedWorkerGlobalScope
const scope = self as unknown as {
  addEventListener(
    type: 'connect',
    listener: (event: { ports: readonly MessagePort[] }) => void,
  ): void;
};

const host = new BatchQueueHost();
scope.addEventListener('connect', (event) => {
  const port: BatchPort | undefined = event.ports[0];
  if (port) host.connect(port);
});
