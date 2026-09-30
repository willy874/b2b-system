import { startChannelHub } from '../relays/sharedWorkerHub';
import type { SharedWorkerScopeLike } from '../relays/sharedWorkerHub';

// tsconfig 只有 DOM lib，self 被型別成 Window；執行期這裡是 SharedWorkerGlobalScope
startChannelHub(self as unknown as SharedWorkerScopeLike);
