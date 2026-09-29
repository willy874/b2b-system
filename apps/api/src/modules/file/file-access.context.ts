import type { PermissionKey } from '@/common/types';
import { PERMISSION } from '@/common/types';
import type { FileFolderKind, GrantLevel } from '@/db/schema';
import {
  assignableLevels,
  levelAllows,
  missingActions,
} from '@/modules/resource-grant/resource-grant.levels';
import type { LevelActions } from '@/modules/resource-grant/resource-grant.levels';
import type { HierarchyNode } from '@/modules/resource-grant/resource-grant.resolver';

/** 檔案動作；與全域權限鍵 `file:<動作>` 一一對應（docs/rbac/07-resource-grants.md §2）。 */
export const FILE_ACTIONS = ['read', 'create', 'update', 'delete', 'share'] as const;
export type FileAction = (typeof FILE_ACTIONS)[number];

export const FILE_ACTION_PERMISSION = {
  read: PERMISSION.FILE_READ,
  create: PERMISSION.FILE_CREATE,
  update: PERMISSION.FILE_UPDATE,
  delete: PERMISSION.FILE_DELETE,
  share: PERMISSION.FILE_SHARE,
} as const satisfies Record<FileAction, PermissionKey>;

/**
 * 等級蘊含的動作。`contributor` 對「自己建立的」項目還能改名、移動、刪除——那是擁有者規則（§4），
 * 不是等級本身的動作，所以不列在這裡。
 */
export const LEVEL_ACTIONS = {
  viewer: ['read'],
  contributor: ['read', 'create'],
  editor: ['read', 'create', 'update', 'delete'],
  manager: ['read', 'create', 'update', 'delete', 'share'],
} as const satisfies LevelActions<FileAction>;

/** 資料夾結構的一個節點：解析等級用的欄位 ＋ 擁有者。 */
export interface FolderNode extends HierarchyNode {
  createdBy: string | null;
}

export interface FileCapabilities {
  canUpdate: boolean;
  canDelete: boolean;
}

export interface FolderCapabilities {
  /** false = 鎖住：看得到資料夾，看不到裡面的檔案（docs/rbac/07-resource-grants.md §5.1）。 */
  canRead: boolean;
  /** 在這個資料夾裡上傳、建立子資料夾。 */
  canCreate: boolean;
  /** 改名、移動這個資料夾。 */
  canUpdate: boolean;
  /** 遞迴刪除這個資料夾（子樹的附加條件在刪除時才檢查，§4）。 */
  canDelete: boolean;
  /** 管理這個資料夾的授權。 */
  canShare: boolean;
}

/** 項目所在的位置：資料夾 id；null 是根目錄。 */
export type FileLocation = string | null;

/**
 * 一個操作者在一次請求內的檔案存取判斷（docs/rbac/07-resource-grants.md §3、§4）。
 * 純計算：全域動作、整棵資料夾結構與已解析的等級都在建構時給定，方法不查資料庫。
 */
export class FileAccessContext {
  constructor(
    readonly actorId: string,
    private readonly globalActions: ReadonlySet<FileAction>,
    readonly folders: ReadonlyMap<string, FolderNode>,
    private readonly levelOf: (folderId: string) => GrantLevel | null,
  ) {}

  /** 全域權限鍵就能做（不受資料夾授權影響，含中斷繼承的資料夾）。 */
  hasGlobal(action: FileAction): boolean {
    return this.globalActions.has(action);
  }

  /** 資料夾授權的有效等級；根目錄、不存在的資料夾是 null。 */
  levelAt(location: FileLocation): GrantLevel | null {
    return location === null ? null : this.levelOf(location);
  }

  /** `has(u, 動作, 位置)`：全域有該權限鍵，或位置的有效等級蘊含該動作。根目錄只看全域。 */
  can(action: FileAction, location: FileLocation): boolean {
    if (this.globalActions.has(action)) return true;
    if (location === null || !this.folders.has(location)) return false;
    return levelAllows<FileAction>(LEVEL_ACTIONS, this.levelOf(location), action);
  }

  /**
   * 項目本身的改名／移動（`update`）或刪除（`delete`）：看它所在的位置；
   * 本人建立的，只要還能在那個位置上傳也可以（擁有者規則）。
   */
  canModify(
    action: 'update' | 'delete',
    location: FileLocation,
    createdBy: string | null,
  ): boolean {
    return (
      this.can(action, location) || (createdBy === this.actorId && this.can('create', location))
    );
  }

  fileCapabilities(file: { folderId: string | null; createdBy: string | null }): FileCapabilities {
    return {
      canUpdate: this.canModify('update', file.folderId, file.createdBy),
      canDelete: this.canModify('delete', file.folderId, file.createdBy),
    };
  }

  folderCapabilities(folder: {
    id: string;
    parentId: string | null;
    createdBy: string | null;
    /** 系統資料夾（共用、私人、個人）不能改名、移動、刪除（docs/rbac/07-resource-grants.md §12）。 */
    kind?: FileFolderKind;
  }): FolderCapabilities {
    const isSystem = folder.kind !== undefined && folder.kind !== 'normal';
    return {
      canRead: this.can('read', folder.id),
      canCreate: this.can('create', folder.id),
      canUpdate: !isSystem && this.canModify('update', folder.parentId, folder.createdBy),
      canDelete: !isSystem && this.canModify('delete', folder.parentId, folder.createdBy),
      canShare: this.can('share', folder.id),
    };
  }

  rootCapabilities(): { canCreate: boolean } {
    return { canCreate: this.can('create', null) };
  }

  /** 資料夾存在（未刪除）。資料夾對所有能進檔案管理器的人可見，能不能讀另外看 `can('read')`。 */
  exists(folderId: string): boolean {
    return this.folders.has(folderId);
  }

  /** 讀得到的資料夾；持有全域 `file:read` 時是 undefined（全部，含根目錄）。 */
  readableFolderIds(): string[] | undefined {
    if (this.globalActions.has('read')) return undefined;
    return [...this.folders.keys()].filter((id) => this.can('read', id));
  }

  /**
   * 反提權（§6.1）：授予、變更或移除等級 `levels` 的授權時，這些等級蘊含、而操作者在 `location` 沒有的動作。
   */
  missingActions(levels: readonly GrantLevel[], location: FileLocation): FileAction[] {
    return missingActions<FileAction>(LEVEL_ACTIONS, levels, FILE_ACTIONS, (action) =>
      this.can(action, location),
    );
  }

  /** 操作者在 `location` 授予得起的等級（前端的等級選單；後端仍會再檢查）。 */
  assignableLevels(location: FileLocation): GrantLevel[] {
    return assignableLevels<FileAction>(LEVEL_ACTIONS, FILE_ACTIONS, (action) =>
      this.can(action, location),
    );
  }
}
