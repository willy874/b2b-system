import {
  resetCommandPaletteRegistry,
  searchProviderRegistry,
} from '@b2b-system/web-core/command-palette';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { registerFileSearch } from '../search';

const { fetchFiles } = vi.hoisted(() => ({ fetchFiles: vi.fn() }));
vi.mock('@/apis/file/get-file-list/fetcher', () => ({ fetchFileListQuery: fetchFiles }));

beforeEach(() => resetCommandPaletteRegistry());

describe('檔案的命令面板搜尋', () => {
  it('不分資料夾搜尋；資料夾裡的檔案連到資料夾並預覽，根目錄的檔案只帶預覽', async () => {
    fetchFiles.mockResolvedValue({
      items: [
        { id: 'f1', name: 'report.pdf', folderId: 'd1' },
        { id: 'f2', name: 'logo.png', folderId: null },
      ],
    });
    registerFileSearch();

    const results = await searchProviderRegistry
      .get('file')
      ?.search('o', new AbortController().signal);

    expect(fetchFiles.mock.calls[0]?.[0].params).toEqual({ offset: 0, limit: 5, keyword: 'o' });
    expect(results?.map((result) => result.link)).toEqual([
      { route: 'file.folderPreview', params: { folderId: 'd1', fileId: 'f1' } },
      { route: 'file.preview', params: { fileId: 'f2' } },
    ]);
  });
});
