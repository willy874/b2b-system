import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { Worker } from 'node:worker_threads';

import { Injectable, Logger } from '@nestjs/common';
import type { OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type { Env } from '@/core/config';
import { AppException } from '@/core/errors';
import { dataTransferParseDuration } from '@/core/metrics';

import { DATA_TRANSFER_PARSE_QUEUE_TIMEOUT_MS } from '../data-transfer.constants';
import type { ParseResponse, ReadSheetOptions, ReadSheetResult } from './sheet-reader';

interface Slot {
  worker: Worker;
  busy: boolean;
  pending?: {
    id: number;
    resolve: (result: ReadSheetResult) => void;
    reject: (error: Error) => void;
  };
}

/**
 * 匯入分析的 worker thread 池（docs/architecture/backend/22-data-transfer.md §7.3、§13 D22）：CSV 解碼與 XLSX 解壓是 CPU 密集的工作，
 * 在主執行緒做會卡住同一個程序的所有請求。每程序 `DATA_TRANSFER_PARSE_WORKERS` 個（第一次使用時才建立）；
 * 都在忙時排隊最多 5 秒，仍拿不到就回 `503 DATA_TRANSFER_BUSY`。worker 掛掉時拒絕它手上的請求並補一個新的。
 */
@Injectable()
export class ParsePool implements OnModuleDestroy {
  private readonly logger = new Logger(ParsePool.name);
  private readonly size: number;
  private readonly slots: Slot[] = [];
  private readonly waiting: {
    resolve: (slot: Slot) => void;
    reject: (error: Error) => void;
    timer: NodeJS.Timeout;
  }[] = [];
  private nextId = 1;
  private closed = false;

  constructor(config: ConfigService<Env, true>) {
    this.size = config.get('DATA_TRANSFER_PARSE_WORKERS', { infer: true });
  }

  async parse(bytes: Uint8Array, options: ReadSheetOptions): Promise<ReadSheetResult> {
    const slot = await this.acquire();
    const end = dataTransferParseDuration.startTimer({ format: options.format });
    try {
      return await new Promise<ReadSheetResult>((resolve, reject) => {
        const id = this.nextId++;
        slot.pending = { id, resolve, reject };
        slot.worker.postMessage({ id, bytes, options });
      });
    } finally {
      end();
      slot.pending = undefined;
      this.release(slot);
    }
  }

  async onModuleDestroy(): Promise<void> {
    this.closed = true;
    for (const waiter of this.waiting.splice(0)) {
      clearTimeout(waiter.timer);
      waiter.reject(new AppException('DATA_TRANSFER_BUSY'));
    }
    await Promise.all(this.slots.splice(0).map((slot) => slot.worker.terminate()));
  }

  private acquire(): Promise<Slot> {
    if (this.closed) return Promise.reject(new AppException('DATA_TRANSFER_BUSY'));
    const idle = this.slots.find((slot) => !slot.busy);
    if (idle) {
      idle.busy = true;
      return Promise.resolve(idle);
    }
    if (this.slots.length < this.size) {
      const slot = this.spawn();
      slot.busy = true;
      return Promise.resolve(slot);
    }
    return new Promise<Slot>((resolve, reject) => {
      const waiter = {
        resolve,
        reject,
        timer: setTimeout(() => {
          this.waiting.splice(this.waiting.indexOf(waiter), 1);
          reject(new AppException('DATA_TRANSFER_BUSY', { retryAfter: 5 }));
        }, DATA_TRANSFER_PARSE_QUEUE_TIMEOUT_MS),
      };
      this.waiting.push(waiter);
    });
  }

  private release(slot: Slot): void {
    if (!this.slots.includes(slot)) {
      // worker 已經出錯或結束、被移出池子：不交給排隊者，改補一個新的
      this.replenish();
      return;
    }
    const next = this.waiting.shift();
    if (next) {
      clearTimeout(next.timer);
      next.resolve(slot);
      return;
    }
    slot.busy = false;
  }

  /** 池子有空位而且有人排隊時，建立一個新的 worker 交給排在最前面的請求。 */
  private replenish(): void {
    if (this.closed || this.slots.length >= this.size) return;
    const next = this.waiting.shift();
    if (!next) return;
    clearTimeout(next.timer);
    const slot = this.spawn();
    slot.busy = true;
    next.resolve(slot);
  }

  private spawn(): Slot {
    const worker = new Worker(workerPath());
    const slot: Slot = { worker, busy: false };
    worker.on('message', (message: ParseResponse) => {
      const pending = slot.pending;
      if (!pending || pending.id !== message.id) return;
      if ('error' in message) pending.reject(new Error(message.error));
      else pending.resolve(message.result);
    });
    worker.on('error', (error) => {
      this.logger.error({ err: error }, '匯入分析的 worker thread 發生錯誤');
      // error 之後 worker 會結束：先移出池子，手上的請求在 finally 釋放時才不會把它交給下一個
      this.remove(slot);
      slot.pending?.reject(error);
    });
    worker.on('exit', (code) => {
      this.remove(slot);
      // 手上還有請求就一定拒絕（含關閉時被 terminate），否則那個 parse() 永遠不會結束
      slot.pending?.reject(
        this.closed
          ? new AppException('DATA_TRANSFER_BUSY')
          : new Error(`匯入分析的 worker thread 結束（exit ${code}）`),
      );
    });
    // 閒置的 worker 不擋程序結束
    worker.unref();
    this.slots.push(slot);
    return slot;
  }

  private remove(slot: Slot): void {
    const index = this.slots.indexOf(slot);
    if (index >= 0) this.slots.splice(index, 1);
  }
}

/** dist 裡是編譯後的 .js；測試直接跑原始碼時是 .ts（Node 以型別剝除執行）。 */
function workerPath(): string {
  const js = join(__dirname, 'sheet-reader.js');
  return existsSync(js) ? js : join(__dirname, 'sheet-reader.ts');
}
