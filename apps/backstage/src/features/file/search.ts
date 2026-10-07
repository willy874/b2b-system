import { registerSearchProvider, SEARCH_RESULT_LIMIT } from '@b2b-system/web-core/command-palette';

import { fetchFileListQuery } from '@/apis/file/get-file-list/fetcher';

import { FILE_PAGE } from './permission';

/**
 * 命令面板：以檔名搜尋所有資料夾（docs/architecture/frontend/18-command-palette.md §4）。選了就打開檔案所在的資料夾並預覽它；
 * 進不了的資料夾，後端本來就不會列出裡面的檔案。這個 feature 是可啟用的：租戶沒啟用時不會登記。
 */
export function registerFileSearch(): void {
  registerSearchProvider({
    key: 'file',
    labelI18nKey: 'menu.file',
    icon: 'file',
    pageKey: FILE_PAGE,
    order: 50,
    search: async (keyword, signal) => {
      const { items } = await fetchFileListQuery({
        params: { offset: 0, limit: SEARCH_RESULT_LIMIT, keyword },
        signal,
      });
      return items.map((file) => ({
        id: file.id,
        label: file.name,
        link: file.folderId
          ? { route: 'file.folderPreview', params: { folderId: file.folderId, fileId: file.id } }
          : { route: 'file.preview', params: { fileId: file.id } },
      }));
    },
  });
}
