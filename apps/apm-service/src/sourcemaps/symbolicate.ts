import { originalPositionFor, sourceContentFor, TraceMap } from '@jridgewell/trace-mapping';

import type { StoredEvent, StoredFrame } from '@/store/types';

import type { SourcemapStore } from './sourcemap-store';

/** 還原後的一層堆疊：原本的位置留在 `raw_*`，查得到原始碼時附上那一行。 */
export interface SymbolicatedFrame extends StoredFrame {
  raw_filename?: string;
  raw_function?: string;
  raw_lineno?: number;
  raw_colno?: number;
  context_line?: string;
  /** 有找到 sourcemap 並對應成功。 */
  symbolicated: boolean;
}

const CACHE_SIZE = 20;
const MAX_CONTEXT_LINE = 300;

/** 堆疊的檔名（`https://host/assets/x.js`）→ sourcemap 的相對路徑（`assets/x.js.map`）。 */
export function sourcemapPathFor(filename: string): string | undefined {
  let path = filename;
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(path)) {
    try {
      path = new URL(path).pathname;
    } catch {
      return undefined;
    }
  } else if (path.startsWith('~/')) {
    path = path.slice(2);
  }
  path = path.replace(/^\/+/, '');
  if (!/\.m?js$/.test(path)) return undefined;
  return `${path}.map`;
}

/**
 * 查詢時以 sourcemap 還原堆疊（docs/architecture/frontend/19-observability.md §9.2 D5）：sourcemap 比事件晚上傳也能還原。
 * 解析過的 sourcemap 以「專案、release、檔案」快取最近 20 份。
 */
export class Symbolicator {
  private readonly cache = new Map<string, TraceMap | null>();

  constructor(private readonly store: SourcemapStore) {}

  private async load(project: string, release: string, path: string): Promise<TraceMap | null> {
    const key = `${project}\n${release}\n${path}`;
    const cached = this.cache.get(key);
    if (cached !== undefined) {
      // 移到最後＝最近使用
      this.cache.delete(key);
      this.cache.set(key, cached);
      return cached;
    }
    const content = await this.store.read(project, release, path);
    let map: TraceMap | null = null;
    if (content !== undefined) {
      try {
        map = new TraceMap(content);
      } catch {
        map = null;
      }
    }
    // 沒有 sourcemap 不快取：之後才上傳的話下次就查得到
    if (map !== null) {
      this.cache.set(key, map);
      if (this.cache.size > CACHE_SIZE) {
        const oldest = this.cache.keys().next().value;
        if (oldest !== undefined) this.cache.delete(oldest);
      }
    }
    return map;
  }

  async frame(
    project: string,
    release: string | undefined,
    frame: StoredFrame,
  ): Promise<SymbolicatedFrame> {
    const unchanged: SymbolicatedFrame = { ...frame, symbolicated: false };
    const filename = frame.abs_path ?? frame.filename;
    if (release === undefined || filename === undefined || frame.lineno === undefined)
      return unchanged;
    const path = sourcemapPathFor(filename);
    if (path === undefined) return unchanged;
    const map = await this.load(project, release, path);
    if (map === null) return unchanged;

    // 堆疊的欄位從 1 起算，sourcemap 從 0 起算
    const position = originalPositionFor(map, {
      line: frame.lineno,
      column: Math.max(0, (frame.colno ?? 1) - 1),
    });
    if (position.source === null || position.line === null) return unchanged;

    const result: SymbolicatedFrame = {
      ...frame,
      filename: position.source,
      abs_path: position.source,
      lineno: position.line,
      colno: (position.column ?? 0) + 1,
      raw_filename: filename,
      raw_lineno: frame.lineno,
      symbolicated: true,
    };
    if (frame.colno !== undefined) result.raw_colno = frame.colno;
    if (frame.function !== undefined) result.raw_function = frame.function;
    if (position.name !== null) result.function = position.name;
    // 依賴套件的堆疊不算 app 的
    result.in_app = !position.source.includes('node_modules');
    const source = sourceContentFor(map, position.source);
    const line = source?.split('\n')[position.line - 1];
    if (line !== undefined) result.context_line = line.trim().slice(0, MAX_CONTEXT_LINE);
    return result;
  }

  async event(
    event: StoredEvent,
  ): Promise<Array<{ exceptionIndex: number; frames: SymbolicatedFrame[] }>> {
    return Promise.all(
      event.exceptions.map(async (exception, exceptionIndex) => ({
        exceptionIndex,
        frames: await Promise.all(
          exception.frames.map((frame) => this.frame(event.project, event.release, frame)),
        ),
      })),
    );
  }
}
