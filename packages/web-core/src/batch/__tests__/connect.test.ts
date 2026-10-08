import { afterEach, describe, expect, it, vi } from 'vitest';

import { connectBatchQueue } from '../connect';
import { isBatchMessage, tagMessage } from '../protocol';
import type { BatchHostMessage } from '../protocol';

afterEach(() => {
  vi.unstubAllGlobals();
});

/** 記下建構參數的假 worker。 */
function fakeWorkerClass() {
  const instances: Array<{ url: URL; options: WorkerOptions }> = [];
  class FakeWorker extends EventTarget {
    readonly postMessage = vi.fn();
    readonly terminate = vi.fn();
    readonly port = { postMessage: vi.fn() };
    constructor(url: URL, options: WorkerOptions) {
      super();
      instances.push({ url, options });
    }
  }
  return { FakeWorker, instances };
}

describe('connectBatchQueue（連上批次佇列）', () => {
  it('支援 SharedWorker 時所有分頁共用一個佇列，佇列不跟著分頁消失', () => {
    const { FakeWorker, instances } = fakeWorkerClass();
    vi.stubGlobal('SharedWorker', FakeWorker);

    const connection = connectBatchQueue();

    expect(connection.mode).toBe('shared-worker');
    expect(connection.ownsHost).toBe(false);
    expect(instances[0]?.url.pathname).toMatch(/batchQueue\.sharedWorker\.ts$/);
    expect(instances[0]?.options).toEqual({ type: 'module', name: 'ge-batch-queue' });
  });

  it('SharedWorker 被停用（建構時丟例外）時退回 dedicated worker', () => {
    vi.stubGlobal(
      'SharedWorker',
      class {
        constructor() {
          throw new Error('SecurityError');
        }
      },
    );
    const { FakeWorker, instances } = fakeWorkerClass();
    vi.stubGlobal('Worker', FakeWorker);

    const connection = connectBatchQueue();

    expect(connection.mode).toBe('worker');
    expect(connection.ownsHost).toBe(true);
    expect(instances[0]?.url.pathname).toMatch(/batchQueue\.worker\.ts$/);
  });

  it('dedicated worker 的 port：訊息與監聽轉給 worker，close 結束 worker', () => {
    vi.stubGlobal('SharedWorker', undefined);
    const { FakeWorker } = fakeWorkerClass();
    let worker: InstanceType<typeof FakeWorker> | undefined;
    vi.stubGlobal(
      'Worker',
      class extends FakeWorker {
        constructor(url: URL, options: WorkerOptions) {
          super(url, options);
          // oxlint-disable-next-line typescript/no-this-alias -- 測試要拿到建立出來的那一個
          worker = this;
        }
      },
    );
    const { port } = connectBatchQueue();
    const listener = vi.fn();

    port.postMessage({ hello: 1 });
    port.addEventListener('message', listener);
    worker?.dispatchEvent(new MessageEvent('message', { data: 'x' }));
    port.removeEventListener('message', listener);
    worker?.dispatchEvent(new MessageEvent('message', { data: 'y' }));
    port.close?.();

    expect(worker?.postMessage).toHaveBeenCalledWith({ hello: 1 });
    expect(listener).toHaveBeenCalledTimes(1);
    expect(worker?.terminate).toHaveBeenCalled();
  });

  it('Worker 也建不起來時，佇列跑在主執行緒', () => {
    vi.stubGlobal('SharedWorker', undefined);
    vi.stubGlobal(
      'Worker',
      class {
        constructor() {
          throw new Error('blocked');
        }
      },
    );

    const connection = connectBatchQueue();
    connection.port.close?.();

    expect(connection).toMatchObject({ mode: 'inline', ownsHost: true });
  });

  it('主執行緒的佇列：送 hello 會收到 welcome', async () => {
    vi.stubGlobal('SharedWorker', undefined);
    vi.stubGlobal('Worker', undefined);
    const { mode, port } = connectBatchQueue();
    const received: BatchHostMessage[] = [];
    port.addEventListener('message', (event) => {
      if (isBatchMessage<BatchHostMessage>(event.data)) received.push(event.data);
    });
    port.start?.();

    port.postMessage(tagMessage({ type: 'hello', clientId: 'tab-1' }));

    await vi.waitFor(() => expect(received.map((message) => message.type)).toContain('welcome'));
    expect(mode).toBe('inline');
    port.close?.();
  });
});
