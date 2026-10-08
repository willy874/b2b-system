import { EventEmitter } from 'node:events';
import { existsSync } from 'node:fs';

import { Logger } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';

import type { Env } from '@/core/config';
import { AppException } from '@/core/errors';

import { DATA_TRANSFER_PARSE_QUEUE_TIMEOUT_MS } from '../data-transfer.constants';
import { ParsePool } from '../import/parse-pool';
import type { ParseRequest, ReadSheetOptions, ReadSheetResult } from '../import/sheet-reader';

// 不真的起 worker thread：以 EventEmitter 假扮，測試自己決定 worker 何時回應、出錯或結束
const workers = vi.hoisted(() => [] as FakeWorkerShape[]);

interface FakeWorkerShape extends EventEmitter {
  path: string;
  postMessage: ReturnType<typeof vi.fn>;
  terminate: ReturnType<typeof vi.fn>;
  unref: ReturnType<typeof vi.fn>;
}

vi.mock('node:worker_threads', async () => {
  const { EventEmitter: Emitter } = await import('node:events');
  class Worker extends Emitter {
    postMessage = vi.fn();
    terminate = vi.fn(async () => 0);
    unref = vi.fn();
    constructor(readonly path: string) {
      super();
      workers.push(this as unknown as FakeWorkerShape);
    }
  }
  return { Worker };
});

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return { ...actual, existsSync: vi.fn(() => false) };
});

const OPTIONS: ReadSheetOptions = { format: 'csv', encoding: 'auto' };
const OK: ReadSheetResult = { ok: true, header: ['email'], rows: [], warnings: [] };

function createPool(size = 1) {
  const config = { get: vi.fn(() => size) } as unknown as ConfigService<Env, true>;
  return new ParsePool(config);
}

/** 最後一次送給 worker 的請求 id。 */
function lastRequestId(worker: FakeWorkerShape): number {
  const request = worker.postMessage.mock.calls.at(-1)?.[0] as ParseRequest | undefined;
  if (!request) throw new Error('worker 沒有收到請求');
  return request.id;
}

function bytes(text = 'email\n') {
  return new Uint8Array(Buffer.from(text));
}

describe('ParsePool（docs/architecture/backend/22-data-transfer.md §7.3、§13 D22）', () => {
  beforeEach(() => {
    workers.length = 0;
    vi.mocked(existsSync).mockReturnValue(false);
    vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('第一次使用才建立 worker，送出位元組與選項，以同一個 id 的回應完成', async () => {
    const pool = createPool(2);
    expect(workers).toHaveLength(0);
    const data = bytes();
    const pending = pool.parse(data, OPTIONS);
    await vi.waitFor(() => expect(workers).toHaveLength(1));
    const worker = workers[0]!;
    expect(worker.unref).toHaveBeenCalled();
    expect(worker.postMessage).toHaveBeenCalledWith({ id: 1, bytes: data, options: OPTIONS });
    worker.emit('message', { id: 1, result: OK });
    await expect(pending).resolves.toEqual(OK);
  });

  it('閒置的 worker 重複使用，不另外建立', async () => {
    const pool = createPool(2);
    const first = pool.parse(bytes(), OPTIONS);
    await vi.waitFor(() => expect(workers).toHaveLength(1));
    workers[0]!.emit('message', { id: 1, result: OK });
    await first;
    const second = pool.parse(bytes(), OPTIONS);
    await vi.waitFor(() => expect(workers[0]!.postMessage).toHaveBeenCalledTimes(2));
    workers[0]!.emit('message', { id: 2, result: OK });
    await expect(second).resolves.toEqual(OK);
    expect(workers).toHaveLength(1);
  });

  it('都在忙但未達上限時再建立一個 worker', async () => {
    const pool = createPool(2);
    const first = pool.parse(bytes(), OPTIONS);
    const second = pool.parse(bytes(), OPTIONS);
    await vi.waitFor(() => expect(workers).toHaveLength(2));
    workers[1]!.emit('message', { id: lastRequestId(workers[1]!), result: OK });
    workers[0]!.emit('message', { id: lastRequestId(workers[0]!), result: OK });
    await expect(Promise.all([first, second])).resolves.toEqual([OK, OK]);
  });

  it('worker 回傳 error 時以那個訊息拒絕', async () => {
    const pool = createPool();
    const pending = pool.parse(bytes(), OPTIONS);
    await vi.waitFor(() => expect(workers).toHaveLength(1));
    workers[0]!.emit('message', { id: 1, error: '讀檔失敗' });
    await expect(pending).rejects.toThrow('讀檔失敗');
  });

  it('id 不符的回應（上一個請求的遲到回應）不影響目前的請求', async () => {
    const pool = createPool();
    const pending = pool.parse(bytes(), OPTIONS);
    await vi.waitFor(() => expect(workers).toHaveLength(1));
    const worker = workers[0]!;
    worker.emit('message', { id: 999, error: '不是這一個' });
    worker.emit('message', { id: 1, result: OK });
    await expect(pending).resolves.toEqual(OK);
    // 沒有進行中的請求時收到回應也只是忽略
    expect(() => worker.emit('message', { id: 1, result: OK })).not.toThrow();
  });

  it('都在忙且達上限時排隊，前一個完成後交給排隊的請求', async () => {
    const pool = createPool(1);
    const first = pool.parse(bytes(), OPTIONS);
    const second = pool.parse(bytes(), OPTIONS);
    await vi.waitFor(() => expect(workers).toHaveLength(1));
    const worker = workers[0]!;
    expect(worker.postMessage).toHaveBeenCalledTimes(1);
    worker.emit('message', { id: 1, result: OK });
    await first;
    await vi.waitFor(() => expect(worker.postMessage).toHaveBeenCalledTimes(2));
    worker.emit('message', { id: 2, result: OK });
    await expect(second).resolves.toEqual(OK);
    expect(workers).toHaveLength(1);
  });

  it('排隊超過時限回 503 DATA_TRANSFER_BUSY（retryAfter 5 秒）', async () => {
    vi.useFakeTimers();
    const pool = createPool(1);
    const first = pool.parse(bytes(), OPTIONS);
    const queued = pool.parse(bytes(), OPTIONS);
    const assertion = expect(queued).rejects.toMatchObject({
      code: 'DATA_TRANSFER_BUSY',
      details: { retryAfter: 5 },
    });
    await vi.advanceTimersByTimeAsync(DATA_TRANSFER_PARSE_QUEUE_TIMEOUT_MS);
    await assertion;
    // 逾時的請求離開佇列：前一個完成後 worker 回到閒置，不會被交給已經放棄的請求
    workers[0]!.emit('message', { id: 1, result: OK });
    await expect(first).resolves.toEqual(OK);
    const next = pool.parse(bytes(), OPTIONS);
    await vi.waitFor(() => expect(workers[0]!.postMessage).toHaveBeenCalledTimes(2));
    workers[0]!.emit('message', { id: lastRequestId(workers[0]!), result: OK });
    await expect(next).resolves.toEqual(OK);
  });

  it('worker 的 error 事件拒絕它手上的請求並記錄', async () => {
    const pool = createPool();
    const pending = pool.parse(bytes(), OPTIONS);
    await vi.waitFor(() => expect(workers).toHaveLength(1));
    const error = new Error('worker 爆了');
    workers[0]!.emit('error', error);
    await expect(pending).rejects.toBe(error);
    expect(Logger.prototype.error).toHaveBeenCalled();
    // 沒有手上的請求時也只記錄
    expect(() => workers[0]!.emit('error', new Error('again'))).not.toThrow();
  });

  it('worker 異常結束時拒絕它手上的請求，下一個請求補一個新的 worker', async () => {
    const pool = createPool();
    const pending = pool.parse(bytes(), OPTIONS);
    await vi.waitFor(() => expect(workers).toHaveLength(1));
    workers[0]!.emit('exit', 1);
    await expect(pending).rejects.toThrow('exit 1');
    const next = pool.parse(bytes(), OPTIONS);
    await vi.waitFor(() => expect(workers).toHaveLength(2));
    workers[1]!.emit('message', { id: lastRequestId(workers[1]!), result: OK });
    await expect(next).resolves.toEqual(OK);
  });

  it('閒置的 worker 正常結束（exit 0）時從池中移除，不拒絕任何請求', async () => {
    const pool = createPool();
    const first = pool.parse(bytes(), OPTIONS);
    await vi.waitFor(() => expect(workers).toHaveLength(1));
    workers[0]!.emit('message', { id: 1, result: OK });
    await first;
    workers[0]!.emit('exit', 0);
    // 已移除的 worker 再收到 exit 也不影響
    workers[0]!.emit('exit', 0);
    const next = pool.parse(bytes(), OPTIONS);
    await vi.waitFor(() => expect(workers).toHaveLength(2));
    workers[1]!.emit('message', { id: lastRequestId(workers[1]!), result: OK });
    await expect(next).resolves.toEqual(OK);
  });

  it('關閉時結束所有 worker、清掉排隊的計時器，之後的請求回 DATA_TRANSFER_BUSY', async () => {
    vi.useFakeTimers();
    const pool = createPool(1);
    void pool.parse(bytes(), OPTIONS).catch(() => undefined);
    void pool.parse(bytes(), OPTIONS);
    await vi.waitFor(() => expect(workers).toHaveLength(1));
    expect(vi.getTimerCount()).toBe(1);
    await pool.onModuleDestroy();
    expect(workers[0]!.terminate).toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
    // 關閉後 worker 結束（非 0）不再拒絕
    expect(() => workers[0]!.emit('exit', 1)).not.toThrow();
    const after = pool.parse(bytes(), OPTIONS);
    await expect(after).rejects.toBeInstanceOf(AppException);
    await expect(after).rejects.toMatchObject({ code: 'DATA_TRANSFER_BUSY' });
  });

  it.each([
    ['dist 有編譯後的 .js 時載入 .js', true, /sheet-reader\.js$/],
    ['否則載入原始碼 .ts', false, /sheet-reader\.ts$/],
  ])('worker 的進入點：%s', async (_name, exists, expected) => {
    vi.mocked(existsSync).mockReturnValue(exists);
    const pool = createPool();
    void pool.parse(bytes(), OPTIONS).catch(() => undefined);
    await vi.waitFor(() => expect(workers).toHaveLength(1));
    expect(workers[0]!.path).toMatch(expected);
    workers[0]!.emit('message', { id: 1, result: OK });
  });
});
