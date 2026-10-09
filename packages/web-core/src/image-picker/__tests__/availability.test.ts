import { QueryClient } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  IMAGE_SOURCE_AVAILABILITY_TIMEOUT_MS,
  invalidateSourceAvailability,
  resolveAvailableSources,
} from '../availability';
import type { ImageSourceDefinition, ImageUsage } from '../types';

const USAGE: ImageUsage = {
  id: 'user.avatar',
  maxSize: 1024,
  contentTypes: ['image/png'],
  minWidth: 1,
  minHeight: 1,
  aspectRatio: null,
  presets: { sm: 32 },
  sources: null,
};

const Component = () => null;
function source(
  id: string,
  isAvailable?: ImageSourceDefinition['isAvailable'],
): ImageSourceDefinition {
  return { id, order: 1, labelKey: id, isAvailable, component: Component };
}

function context(usage: ImageUsage = USAGE) {
  return { usage, can: (key: string) => key === 'file:access', queryClient: new QueryClient() };
}

describe('resolveAvailableSources（docs/architecture/frontend/23-image-picker.md §2）', () => {
  afterEach(() => vi.useRealTimers());

  it('同步的權限判斷、用途的來源限制都要通過', async () => {
    const sources = [
      source('file', ({ can }) => can('file:access' as never)),
      source('gallery', ({ can }) => can('gallery:read' as never)),
      source('plain'),
    ];
    expect((await resolveAvailableSources(sources, context())).map((s) => s.id)).toEqual([
      'file',
      'plain',
    ]);
    const onlyUpload = { ...USAGE, sources: ['upload'] };
    expect(await resolveAvailableSources(sources, context(onlyUpload))).toEqual([]);
  });

  it('非同步的判斷：有內容才列出；失敗或逾時當作不可用', async () => {
    vi.useFakeTimers();
    const sources = [
      source('recent', async () => true),
      source('empty', async () => false),
      source('broken', async () => Promise.reject(new Error('down'))),
      source('slow', () => new Promise<boolean>(() => undefined)),
    ];
    const resolved = resolveAvailableSources(sources, context());
    await vi.advanceTimersByTimeAsync(IMAGE_SOURCE_AVAILABILITY_TIMEOUT_MS);
    expect((await resolved).map((s) => s.id)).toEqual(['recent']);
  });

  it('非同步的結果快取：再判斷一次不重打；選好一張圖之後失效', async () => {
    const isAvailable = vi.fn(async () => true);
    const sources = [source('recent', isAvailable)];
    const ctx = context();
    await resolveAvailableSources(sources, ctx);
    await resolveAvailableSources(sources, ctx);
    // 第二次呼叫了 isAvailable（拿到 promise），但 queryFn 沒有再跑：結果來自快取
    expect(ctx.queryClient.getQueryCache().findAll()).toHaveLength(1);
    await invalidateSourceAvailability(ctx.queryClient);
    expect(ctx.queryClient.getQueryCache().findAll()[0]?.state.isInvalidated).toBe(true);
  });
});
