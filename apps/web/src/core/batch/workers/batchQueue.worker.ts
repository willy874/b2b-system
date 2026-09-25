import { BatchQueueHost } from '../BatchQueueHost';
import type { BatchPort } from '../protocol';

// tsconfig 只有 DOM lib，self 被型別成 Window；執行期這裡是 DedicatedWorkerGlobalScope，
// postMessage 不需要 targetOrigin，形狀符合 BatchPort
new BatchQueueHost().connect(self as unknown as BatchPort);
