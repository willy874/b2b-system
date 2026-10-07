import { createReadStream } from 'node:fs';
import { appendFile, mkdir, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { createInterface } from 'node:readline';

import type { StoredEvent } from './types';

const DAY_MS = 24 * 60 * 60 * 1000;
const FILE_PATTERN = /^(\d{4}-\d{2}-\d{2})\.ndjson$/;

function dayOf(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/**
 * 錯誤事件存成每個專案每天一個 NDJSON 檔（設計決策 D6）：
 * `<dataDir>/events/<project>/<yyyy-mm-dd>.ndjson`，日期是 apm-service **收到** 的日期（UTC）。
 *
 * 規模是單一產品的前端錯誤，查詢以「讀最近幾天的檔案」完成，不需要資料庫。
 * 同一個程序內的寫入依序進行（`appendFile` 一次寫一整行），不會交錯。
 */
export class EventStore {
  private writes: Promise<void> = Promise.resolve();

  private constructor(private readonly root: string) {}

  static async open(dataDir: string): Promise<EventStore> {
    const root = join(dataDir, 'events');
    await mkdir(root, { recursive: true });
    return new EventStore(root);
  }

  async append(event: StoredEvent): Promise<void> {
    const directory = join(this.root, event.project);
    const file = join(directory, `${dayOf(new Date(event.receivedAt))}.ndjson`);
    const line = `${JSON.stringify(event)}\n`;
    const write = this.writes.then(async () => {
      await mkdir(directory, { recursive: true });
      await appendFile(file, line, 'utf8');
    });
    // 一筆失敗不讓後面的寫入一起失敗
    this.writes = write.catch(() => undefined);
    await write;
  }

  /** 專案在 `since` 之後（含當天）的檔案，新的在前。 */
  private async files(project: string, since: Date): Promise<string[]> {
    const directory = join(this.root, project);
    let names: string[];
    try {
      names = await readdir(directory);
    } catch {
      return [];
    }
    const from = dayOf(since);
    return names
      .filter((name) => {
        const day = FILE_PATTERN.exec(name)?.[1];
        return day !== undefined && day >= from;
      })
      .toSorted()
      .toReversed()
      .map((name) => join(directory, name));
  }

  /**
   * 逐筆讀出 `since` 之後收到的事件（新的檔案在前，同一個檔案內依寫入順序）。
   * `prefilter` 是在 JSON.parse 之前的字串比對，用來略過明顯不相干的行。
   */
  async *scan(
    project: string,
    since: Date,
    prefilter?: (line: string) => boolean,
  ): AsyncGenerator<StoredEvent> {
    const sinceIso = since.toISOString();
    for (const file of await this.files(project, since)) {
      const lines = createInterface({ input: createReadStream(file, 'utf8'), crlfDelay: Infinity });
      // oxlint-disable-next-line no-await-in-loop -- 依序讀檔：新的檔案在前，呼叫端找到就停
      for await (const line of lines) {
        if (line === '' || (prefilter && !prefilter(line))) continue;
        let event: StoredEvent;
        try {
          event = JSON.parse(line) as StoredEvent;
        } catch {
          // 寫到一半就停機時，最後一行可能不完整：略過
          continue;
        }
        if (event.receivedAt >= sinceIso) yield event;
      }
    }
  }

  async findById(project: string, eventId: string, since: Date): Promise<StoredEvent | undefined> {
    const needle = `"eventId":"${eventId}"`;
    for await (const event of this.scan(project, since, (line) => line.includes(needle))) {
      if (event.eventId === eventId) return event;
    }
    return undefined;
  }

  /** 刪掉超過保留天數的檔案；回傳刪掉幾個。 */
  async purgeOlderThan(retentionDays: number, now: Date = new Date()): Promise<number> {
    const cutoff = dayOf(new Date(now.getTime() - retentionDays * DAY_MS));
    let removed = 0;
    let projects: string[];
    try {
      projects = await readdir(this.root);
    } catch {
      return 0;
    }
    for (const project of projects) {
      const directory = join(this.root, project);
      let names: string[];
      try {
        // oxlint-disable-next-line no-await-in-loop -- 專案只有幾個，依序處理即可
        names = await readdir(directory);
      } catch {
        continue;
      }
      for (const name of names) {
        const day = FILE_PATTERN.exec(name)?.[1];
        if (day === undefined || day >= cutoff) continue;
        // oxlint-disable-next-line no-await-in-loop -- 每 6 小時一次、每天一個檔，依序刪除即可
        await rm(join(directory, name), { force: true });
        removed += 1;
      }
    }
    return removed;
  }
}
