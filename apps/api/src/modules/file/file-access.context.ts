import type { PermissionKey } from '@/common/types';
import { PERMISSION } from '@/common/types';
import { TENANT_OBJECT } from '@/core/authz';
import type { AuthzChecker, AuthzPath } from '@/core/authz';
import type { FileFolderKind } from '@/db/schema';

import { assignableLevels, missingActions } from './file-grant.levels';
import type { GrantLevel, HierarchyNode, LevelActions } from './file-grant.levels';
import { itemEdges, locationObject } from './file.authz';

/** 檔案動作；與全域權限鍵 `file:<動作>` 一一對應（docs/architecture/iam/06-resource-grants.md §2）。 */
export const FILE_ACTIONS = ['read', 'create', 'update', 'delete', 'share'] as const;
export type FileAction = (typeof FILE_ACTIONS)[number];

export const FILE_ACTION_PERMISSION = {
  read: PERMISSION.FILE_READ,
  create: PERMISSION.FILE_CREATE,
  update: PERMISSION.FILE_UPDATE,
  delete: PERMISSION.FILE_DELETE,
  share: PERMISSION.FILE_SHARE,
} as const satisfies Record<FileAction, PermissionKey>;

/** 檔案動作 ↔ 位置（資料夾、根目錄）上的關係（file.authz.ts）。 */
export const FILE_ACTION_RELATION = {
  read: 'can_read',
  create: 'can_create',
  update: 'can_update',
  delete: 'can_delete',
  share: 'can_share',
} as const satisfies Record<FileAction, string>;

/** 資料夾結構的一個節點：解析等級用的欄位 ＋ 建立者 ＋ 種類與個人資料夾的擁有者（決定別人看不看得到）。 */
export interface FolderNode extends HierarchyNode {
  createdBy: string | null;
  /** 沒帶（測試的假資料）＝一般資料夾。 */
  kind?: FileFolderKind;
  ownerId?: string | null;
}

export interface FileCapabilities {
  canUpdate: boolean;
  canDelete: boolean;
}

export interface FolderCapabilities {
  /** false = 鎖住：看得到資料夾，看不到裡面的檔案（docs/architecture/iam/06-resource-grants.md §5.1）。 */
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
 * 一個操作者在一次請求內的檔案存取判斷（docs/architecture/iam/06-resource-grants.md §3、§4）。
 * 判斷交給關係圖（`file.authz.ts` 的模型）；資料在建構前已載入，方法不查資料庫。
 */
export class FileAccessContext {
  constructor(
    readonly actorId: string,
    readonly folders: ReadonlyMap<string, FolderNode>,
    private readonly checker: AuthzChecker,
    /** 每個等級蘊含的動作（由模型的靜態蘊含算出，反提權用）。 */
    private readonly levelActions: LevelActions<FileAction>,
  ) {}

  /** 全域權限鍵就能做（不受資料夾授權影響，含中斷繼承的資料夾）。 */
  hasGlobal(action: FileAction): boolean {
    return this.checker.check(TENANT_OBJECT, FILE_ACTION_PERMISSION[action]);
  }

  /** `has(u, 動作, 位置)`：全域有該權限鍵，或位置的有效等級蘊含該動作。根目錄只看全域。 */
  can(action: FileAction, location: FileLocation): boolean {
    return this.checker.check(locationObject(location), FILE_ACTION_RELATION[action]);
  }

  /**
   * `can(action, location)` 成立的一條路徑（從主體閉包裡的主體開始；接上閉包的來歷見 `withClosurePath`）；
   * 不成立是 null（「為什麼能做」的說明，docs/architecture/iam/01-model.md §9 G4b）。
   */
  explain(action: FileAction, location: FileLocation): AuthzPath | null {
    return this.checker.explain(locationObject(location), FILE_ACTION_RELATION[action]);
  }

  /**
   * 項目本身的改名／移動（`update`）或刪除（`delete`）：看它所在的位置；
   * 本人建立的，只要還能在那個位置上傳也可以（擁有者規則，規則 A）。
   */
  canModify(
    action: 'update' | 'delete',
    location: FileLocation,
    createdBy: string | null,
  ): boolean {
    // 結果只取決於「所在位置 × 建立者」：以它當臨時物件的 id，同一個組合只算一次
    const item = { type: 'file', id: `${location ?? 'root'}|${createdBy ?? ''}` };
    return this.checker
      .withEdges(item, itemEdges(location, createdBy))
      .check(item, action === 'update' ? 'can_rename' : 'can_remove');
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
    /** 系統資料夾（共用、私人、個人）不能改名、移動、刪除（docs/architecture/iam/06-resource-grants.md §12）。 */
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

  /**
   * 資料夾存在（未刪除）而且看得到。資料夾對所有能進檔案管理器的人可見，能不能讀另外看 `can('read')`；
   * 唯一的例外是別人的個人資料夾（`isHidden`）：看不到的一律當作不存在（`404 FILE_FOLDER_NOT_FOUND`）。
   */
  exists(folderId: string): boolean {
    return this.folders.has(folderId) && !this.isHidden(folderId);
  }

  /**
   * 別人的個人資料夾（與它的子孫）對這個操作者隱藏（docs/architecture/iam/06-resource-grants.md §12.1）：
   * - 全域 `file:read`（讀得到全部）或 `file:listPersonal`（看得到、鎖住）：都不隱藏；
   * - 否則只有「自己或任一子孫讀得到」的節點出現（本身讀不到的以鎖住的節點出現，才走得到裡面被分享的資料夾）。
   * 一次請求只算一次（由下往上，O(n)）。
   */
  isHidden(folderId: string): boolean {
    this.hidden ??= this.computeHidden();
    return this.hidden.has(folderId);
  }

  private hidden: ReadonlySet<string> | undefined;

  private computeHidden(): ReadonlySet<string> {
    if (
      this.hasGlobal('read') ||
      this.checker.check(TENANT_OBJECT, PERMISSION.FILE_LIST_PERSONAL)
    ) {
      return new Set();
    }
    const children = new Map<string, string[]>();
    for (const node of this.folders.values()) {
      if (node.parentId === null) continue;
      const siblings = children.get(node.parentId);
      if (siblings) siblings.push(node.id);
      else children.set(node.parentId, [node.id]);
    }
    const hidden = new Set<string>();
    /** 子樹裡有讀得到的節點：回傳 true；整棵子樹都讀不到的節點記為隱藏。 */
    const visit = (id: string): boolean => {
      let visible = this.can('read', id);
      for (const child of children.get(id) ?? []) {
        // 每個子節點都要走過：讀得到的子樹以外的分支也要標成隱藏
        if (visit(child)) visible = true;
      }
      if (!visible) hidden.add(id);
      return visible;
    };
    for (const node of this.folders.values()) {
      if (node.kind === 'personal' && node.ownerId !== this.actorId) visit(node.id);
    }
    return hidden;
  }

  /** 讀得到的資料夾；持有全域 `file:read` 時是 undefined（全部，含根目錄）。 */
  readableFolderIds(): string[] | undefined {
    if (this.hasGlobal('read')) return undefined;
    // 讀得到的節點不會被隱藏（隱藏的定義就是整棵子樹讀不到）
    return [...this.folders.keys()].filter((id) => this.can('read', id));
  }

  /**
   * 反提權（§6.1）：授予、變更或移除等級 `levels` 的授權時，這些等級蘊含、而操作者在 `location` 沒有的動作。
   */
  missingActions(levels: readonly GrantLevel[], location: FileLocation): FileAction[] {
    return missingActions<FileAction>(this.levelActions, levels, FILE_ACTIONS, (action) =>
      this.can(action, location),
    );
  }

  /** 操作者在 `location` 授予得起的等級（前端的等級選單；後端仍會再檢查）。 */
  assignableLevels(location: FileLocation): GrantLevel[] {
    return assignableLevels<FileAction>(this.levelActions, FILE_ACTIONS, (action) =>
      this.can(action, location),
    );
  }
}
