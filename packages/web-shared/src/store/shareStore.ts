import { createInstanceId } from '../channel';
import type { Channel } from '../channel';
import type { StoreApi } from './createStore';

/** 帶版本的狀態：`version` 越大越新；同版本以 `writer` 決定勝負，所有參與者判定一致。 */
interface VersionedState<S> {
  state: S;
  version: number;
  writer: string;
}

export type ShareStoreMessages<S> = {
  /** 新參與者加入：請有狀態的參與者回覆目前的快照。 */
  'snapshot-request': Record<string, never>;
  /** 本地修改或回覆快照都用同一種訊息；收訊方一律依版本判斷要不要套用。 */
  state: VersionedState<S>;
};

/**
 * 讓同一個 store 在所有參與者之間是 **單一份狀態**（例：同源的所有分頁）。
 * 與 `syncStore` 的差別：
 *
 * | | `syncStore` | `shareStore` |
 * | --- | --- | --- |
 * | 新分頁的初始值 | 由持久化水合，不向其他分頁要 | **向其他分頁要目前的快照** |
 * | 同時修改 | 各分頁以最後收到的為準，可能不一致 | **版本號 ＋ 寫入者 id**，最後收斂到同一個值 |
 *
 * 適合 **不持久化**、但所有分頁必須看到同一份的狀態；會寫進 localStorage 的狀態用 `syncStore` 或帶頻道的 `dictStorage` 就夠了。
 *
 * 規則：
 * - 本地改到 `keys` 裡的欄位 → 版本 +1 並廣播。收到的版本比自己新（同版本時寫入者 id 較大）才套用，
 *   並採用對方的版本；之後的本地修改一定比收到的新（Lamport clock）。
 * - 加入時送出 `snapshot-request`；只有改過狀態（版本 > 0）的參與者回覆，所以沒人改過時保持初始值。
 * - 收到快照之前的本地修改，若版本較舊會被快照覆蓋——已經有人改過的狀態優先。
 * - 只同步 `keys` 列出的資料欄位；action（函式）無法傳遞，也不該傳。
 *
 * @param channel 所有參與者同名的頻道（慣例 `createChannel('shared:<name>')`）；交給 `shareStore` 後由它負責關閉
 * @returns 停止共享並關閉頻道
 */
export function shareStore<T extends object, K extends keyof T>(
  store: StoreApi<T>,
  keys: readonly K[],
  channel: Channel<ShareStoreMessages<Pick<T, K>>>,
): () => void {
  const self = createInstanceId();
  let version = 0;
  let writer = self;
  let isApplyingRemote = false;

  const pick = (state: T): Pick<T, K> => {
    const picked = {} as Pick<T, K>;
    for (const key of keys) picked[key] = state[key];
    return picked;
  };

  const current = (): VersionedState<Pick<T, K>> => ({
    state: pick(store.getState()),
    version,
    writer,
  });

  const isNewer = (remote: VersionedState<Pick<T, K>>): boolean =>
    remote.version > version || (remote.version === version && remote.writer > writer);

  const offStore = store.subscribe((state, previous) => {
    if (isApplyingRemote) return;
    if (keys.every((key) => Object.is(state[key], previous[key]))) return;
    version += 1;
    writer = self;
    channel.post('state', current());
  });

  const offState = channel.on('state', (remote) => {
    if (!isNewer(remote)) return;
    version = remote.version;
    writer = remote.writer;
    isApplyingRemote = true;
    try {
      store.setState(remote.state as Partial<T>);
    } finally {
      isApplyingRemote = false;
    }
  });

  const offRequest = channel.on('snapshot-request', () => {
    // 沒改過的初始值不回覆：否則新分頁會拿到別人的預設值，並依寫入者 id 隨機覆蓋自己的
    if (version > 0) channel.post('state', current());
  });

  channel.post('snapshot-request', {});

  return () => {
    offStore();
    offState();
    offRequest();
    channel.close();
  };
}
