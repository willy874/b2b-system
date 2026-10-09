/**
 * 多選的共用機制（docs/architecture/frontend/12-file-manager.md §7）：框選的幾何與 hook。
 * 不認識任何項目的版面——命中由呼叫端以自己的版面計算（例：檔案管理器的 `hitTest(layout, rect, count)`）。
 */
export * from './geometry';
export * from './useMarqueeSelection';
