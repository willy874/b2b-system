import { describe, expect, it, vi } from 'vitest';

import type { CdnPathResolver } from '@/core/storage';

import { FileCdnPaths } from '../file-cdn-paths';
import { fileVariantKeysOf } from '../file.constants';
import type { FileRepository } from '../file.repository';

const ID = '33333333-3333-4333-8333-333333333333';

describe('FileCdnPaths（fileVariant 的路徑解析；docs/architecture/backend/09-file.md §16.11）', () => {
  it('每個變體 × 每種格式，只由 id 決定（物件不必還在）', () => {
    const keys = fileVariantKeysOf(ID);
    expect(keys).toContain(`variants/${ID}/preview.webp`);
    expect(keys).toContain(`variants/${ID}/original.avif`);
    expect(keys).toHaveLength(12);
    expect(keys.every((key) => key.startsWith(`variants/${ID}/`))).toBe(true);
  });

  it('在 onModuleInit 登記；回收桶裡的檔案也列出，找不到回 null', async () => {
    const register = vi.fn();
    const files = {
      findById: vi.fn(async () => undefined),
      findDeletedById: vi.fn(async (id: string) => (id === ID ? { id } : undefined)),
    };
    const paths = new FileCdnPaths(
      { register } as unknown as CdnPathResolver,
      files as unknown as FileRepository,
    );
    paths.onModuleInit();
    expect(register).toHaveBeenCalledWith('fileVariant', expect.any(Function));
    expect(await paths.keysOf(ID)).toEqual(fileVariantKeysOf(ID));
    expect(await paths.keysOf('44444444-4444-4444-8444-444444444444')).toBeNull();
  });
});
