import { subjectKey } from '@/core/authz';
import type { EdgeProvider } from '@/core/authz';

import type { FolderNode } from './file-access.context';
import { FILE_ROOT_OBJECT } from './file.authz';

const ROOT_KEY = subjectKey(FILE_ROOT_OBJECT.type, FILE_ROOT_OBJECT.id);

/**
 * 資料夾的結構邊由 `file_folders` 供應，不存進 relation_tuples（docs/adr/0024-relationship-based-access-control.md D3）：
 * `parent`（頂層資料夾指向根目錄）、`inherits_from`（中斷繼承的沒有）、`owner`（建立者）。
 * 不存在的資料夾沒有任何結構邊（只剩全域權限）。
 */
export function folderEdgeProvider(folders: ReadonlyMap<string, FolderNode>): EdgeProvider {
  return (object, relation) => {
    if (object.type !== 'fileFolder') return undefined;
    if (relation !== 'parent' && relation !== 'inherits_from' && relation !== 'owner') {
      return undefined;
    }
    const node = folders.get(object.id);
    if (!node) return [];
    switch (relation) {
      case 'parent':
        return [node.parentId ? subjectKey('fileFolder', node.parentId) : ROOT_KEY];
      case 'inherits_from':
        return node.inheritGrants && node.parentId ? [subjectKey('fileFolder', node.parentId)] : [];
      case 'owner':
        return node.createdBy ? [subjectKey('user', node.createdBy)] : [];
    }
  };
}
