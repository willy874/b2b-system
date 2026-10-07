import { BatchQueueHost } from '../BatchQueueHost';
import type { BatchPort } from '../protocol';

// tsconfig 只有 DOM lib，self 被型別成 Window；執行期這裡是 DedicatedWorkerGlobalScope，
// postMessage 不需要 targetOrigin，形狀符合 BatchPort
const host = new BatchQueueHost();
host.connect(self as unknown as BatchPort);

// 佇列裡未捕捉的例外轉給分頁上報（docs/architecture/frontend/19-observability.md §2）
self.addEventListener('error', (event) => host.reportError(event.error ?? event.message));
self.addEventListener('unhandledrejection', (event) => host.reportError(event.reason));
