import { vi } from 'vitest';

import {
  buildTenantType,
  createChecker,
  createModel,
  createSnapshot,
  ROLE_TYPE,
  tenantEdgeProvider,
  USER_TYPE,
} from '@/core/authz';
import type {
  AuthzRegistry,
  AuthzService,
  EdgeProvider,
  SubjectKey,
  TupleEntry,
} from '@/core/authz';
import type { AuditService } from '@/modules/audit-log/audit.service';
import type { PermissionService } from '@/modules/permission/permission.service';

import { FILE_ACTION_PERMISSION, FILE_ACTIONS } from '../file-access.context';
import type { FileAction, FolderNode } from '../file-access.context';
import { FileAccessService } from '../file-access.service';
import type { FileFolderTree } from '../file-folder-tree';
import type { GrantLevel } from '../file-grant.levels';
import { FILE_AUTHZ_TYPES } from '../file.authz';

/** 操作者（經由假角色）在某個資料夾上的直接授權。 */
export interface LevelGrant {
  resourceId: string;
  level: GrantLevel;
}

export interface AccessFixtureOptions {
  /** 操作者的全域檔案動作；預設全部（管理員）。 */
  global?: readonly FileAction[];
  /** 操作者（本人 ＋ 角色）的資料夾授權。 */
  grants?: LevelGrant[];
  /** 整棵資料夾結構；以函式傳入，才會反映測試途中的變化。 */
  nodes?: () => FolderNode[];
}

/** 操作者持有的一個假角色：全域權限鍵與資料夾授權都掛在它身上。 */
const FIXTURE_ROLE: SubjectKey = 'role:fixture#holder';

/**
 * 真的 `FileAccessService`（規則不 mock，判斷走真的關係圖模型），只把資料來源換成假的：
 * 全域權限、授權、資料夾結構由測試指定，轉成記憶體裡的 tuple。
 */
export function createFileAccess(options: AccessFixtureOptions = {}) {
  const global = options.global ?? FILE_ACTIONS;
  const model = createModel([
    USER_TYPE,
    ROLE_TYPE,
    buildTenantType({ withDependencies: true }),
    ...FILE_AUTHZ_TYPES,
  ]);
  const permissions = {
    getPermissionSet: vi.fn(async (actorId: string) => ({
      permissions: new Set(global.map((action) => FILE_ACTION_PERMISSION[action])),
      isSuperAdmin: false,
      subjects: [`user:${actorId}`, 'user:*', FIXTURE_ROLE],
    })),
  };
  const tuples = (): TupleEntry[] => [
    ...global.map((action) => ({
      object: { type: 'tenant', id: 'self' },
      relation: FILE_ACTION_PERMISSION[action],
      subject: FIXTURE_ROLE,
    })),
    ...(options.grants ?? []).map((grant) => ({
      object: { type: 'fileFolder', id: grant.resourceId },
      relation: grant.level,
      subject: FIXTURE_ROLE,
    })),
  ];
  const authz = {
    checkerFor: vi.fn(
      async (subjects: readonly SubjectKey[], _types: unknown, providers: EdgeProvider[]) =>
        createChecker(
          model,
          createSnapshot(subjects, tuples(), [tenantEdgeProvider, ...providers]),
        ),
    ),
  };
  const tree = { nodes: vi.fn(async () => options.nodes?.() ?? []) };
  const audit = { recordSafely: vi.fn(async () => undefined) };
  const access = new FileAccessService(
    permissions as unknown as PermissionService,
    tree as unknown as FileFolderTree,
    audit as unknown as AuditService,
    authz as unknown as AuthzService,
    { register: vi.fn(), model: () => model } as unknown as AuthzRegistry,
  );
  return { access, audit, permissions };
}
