import { describe, expect, it, vi } from 'vitest';

import type { PermissionKey } from '@/common/types';

import { TRASH_PERMISSIONS, TRASH_RESOURCE_TYPES } from '../trash.constants';
import type { TrashResourceType } from '../trash.constants';
import { TrashRegistry } from '../trash.registry';
import type { TrashHandler } from '../trash.types';

/** 每個類型實際註冊時用的權限（docs/architecture/backend/14-revisions.md §9.2 D10：能刪就能復原）。 */
const PERMISSION_OF: Record<TrashResourceType, PermissionKey> = {
  user: 'user:delete',
  role: 'role:delete',
  group: 'group:delete',
  file: 'file:delete',
  fileFolder: 'file:delete',
  announcement: 'announcement:delete',
  orgUnit: 'orgUnit:delete',
};

function handler(type: TrashResourceType, purgeOrder = 10): TrashHandler {
  return {
    type,
    permission: PERMISSION_OF[type],
    purgeOrder,
    listDeleted: vi.fn(async () => ({ items: [], total: 0 })),
    findExpired: vi.fn(async () => []),
    purge: vi.fn(async () => true),
    afterPurge: vi.fn(async () => {}),
  };
}

function registerAll(registry: TrashRegistry, except: readonly TrashResourceType[] = []): void {
  TRASH_RESOURCE_TYPES.filter((type) => !except.includes(type)).forEach((type, index) =>
    registry.register(handler(type, index)),
  );
}

describe('TrashRegistry（docs/architecture/backend/13-trash.md、14-revisions.md §9.2 D9）', () => {
  it('類型不在 TRASH_RESOURCE_TYPES（DTO 的 enum 看不到）→ 註冊時拋錯', () => {
    const registry = new TrashRegistry();
    const unknown = { ...handler('user'), type: 'tag' } as unknown as TrashHandler;
    expect(() => registry.register(unknown)).toThrow(/TRASH_RESOURCE_TYPES/);
  });

  it('擋下的註冊不會留下 handler（之後 get 仍找不到）', () => {
    const registry = new TrashRegistry();
    expect(() =>
      registry.register({ ...handler('user'), permission: 'user:read' as PermissionKey }),
    ).toThrow();
    expect(() => registry.get('user')).toThrow(/沒有註冊 handler/);
  });

  it.each(TRASH_RESOURCE_TYPES.map((type) => [type]))(
    '%s 以它的 <resource>:delete 權限可以註冊並以 get 取回',
    (type) => {
      const registry = new TrashRegistry();
      const registered = handler(type);
      registry.register(registered);
      expect(registry.get(type)).toBe(registered);
    },
  );

  it('每個類型註冊時用的權限都在 TRASH_PERMISSIONS（GET /trash 的路由宣告）', () => {
    for (const type of TRASH_RESOURCE_TYPES) {
      expect(TRASH_PERMISSIONS).toContain(PERMISSION_OF[type]);
    }
  });

  it('沒註冊的類型 → get 拋錯（程式錯誤）', () => {
    expect(() => new TrashRegistry().get('role')).toThrow(/role 沒有註冊 handler/);
  });

  it('所有類型都有 handler → 啟動檢查通過', () => {
    const registry = new TrashRegistry();
    registerAll(registry);
    expect(() => registry.onApplicationBootstrap()).not.toThrow();
  });

  it('啟動檢查的錯誤訊息只列出缺少的類型', () => {
    const registry = new TrashRegistry();
    registerAll(registry, ['group', 'announcement']);
    expect(() => registry.onApplicationBootstrap()).toThrow(
      '回收桶類型沒有註冊 handler：group, announcement',
    );
  });

  it('inPurgeOrder：檔案 → 資料夾 → 使用者 → 角色（不受註冊順序影響）', () => {
    const registry = new TrashRegistry();
    registry.register(handler('role', 40));
    registry.register(handler('user', 30));
    registry.register(handler('file', 10));
    registry.register(handler('fileFolder', 20));
    expect(registry.inPurgeOrder().map((registered) => registered.type)).toEqual([
      'file',
      'fileFolder',
      'user',
      'role',
    ]);
  });

  it('沒有任何 handler → inPurgeOrder 是空陣列', () => {
    expect(new TrashRegistry().inPurgeOrder()).toEqual([]);
  });
});
