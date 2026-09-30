import { vi } from 'vitest';

import type { AuditService } from '@/modules/audit-log/audit.service';
import type { PermissionService } from '@/modules/permission/permission.service';
import type { LevelGrant } from '@/modules/resource-grant/resource-grant.resolver';
import type { ResourceGrantService } from '@/modules/resource-grant/resource-grant.service';

import { FILE_ACTION_PERMISSION, FILE_ACTIONS } from '../file-access.context';
import type { FileAction, FolderNode } from '../file-access.context';
import { FileAccessService } from '../file-access.service';
import type { FileFolderTree } from '../file-folder-tree';

export interface AccessFixtureOptions {
  /** 操作者的全域檔案動作；預設全部（管理員）。 */
  global?: readonly FileAction[];
  /** 操作者（本人 ＋ 角色）的資料夾授權。 */
  grants?: LevelGrant[];
  /** 整棵資料夾結構；以函式傳入，才會反映測試途中的變化。 */
  nodes?: () => FolderNode[];
}

/**
 * 真的 `FileAccessService`（規則不 mock），只把它的資料來源換成假的：
 * 權限集合、授權、資料夾結構由測試指定。
 */
export function createFileAccess(options: AccessFixtureOptions = {}) {
  const global = options.global ?? FILE_ACTIONS;
  const permissions = {
    getPermissionSet: vi.fn(async () => ({
      permissions: new Set(global.map((action) => FILE_ACTION_PERMISSION[action])),
      isSuperAdmin: false,
    })),
  };
  const grants = { grantsFor: vi.fn(async () => options.grants ?? []) };
  const tree = { nodes: vi.fn(async () => options.nodes?.() ?? []) };
  const audit = { recordSafely: vi.fn(async () => undefined) };
  const access = new FileAccessService(
    permissions as unknown as PermissionService,
    grants as unknown as ResourceGrantService,
    tree as unknown as FileFolderTree,
    audit as unknown as AuditService,
  );
  return { access, audit, permissions, grants };
}
