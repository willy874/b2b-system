import type { ResourceChangeWire } from '@b2b-system/realtime';
import { describe, expect, it, vi } from 'vitest';

// perm room 帶租戶（docs/architecture/05-tenancy.md §10.2 D17）：固定在租戶 t1
vi.mock('@/core/tenant', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/core/tenant')>()),
  requireTenant: () => ({ id: 't1' }),
}));

import type { PermissionService } from '@/modules/permission/permission.service';

import { RealtimeAudience, resolveAudienceRooms } from '../realtime.audience';
import type { RealtimePublisher } from '../realtime.publisher';
import { allPermRooms, permRoomsFor } from '../realtime.rooms';

const sorted = (rooms: string[]) => rooms.toSorted();

describe('來源 → 受眾（docs/architecture/backend/08-realtime.md §6.1）', () => {
  const cases: Array<{ name: string; change: ResourceChangeWire; rooms: string[] }> = [
    {
      name: 'user：user:read、role:read 與被改的那個人',
      change: { resource: 'user', kind: 'update', id: 'u1' },
      rooms: [
        't:t1:perm:auditLog:read',
        't:t1:perm:role:read',
        't:t1:perm:user:read',
        't:t1:user:u1',
      ],
    },
    {
      name: 'userRole：user:read、role:read 與被指派的那個人',
      change: { resource: 'userRole', kind: 'update', id: 'u1', refs: { role: ['r1'] } },
      rooms: [
        't:t1:perm:auditLog:read',
        't:t1:perm:role:read',
        't:t1:perm:user:read',
        't:t1:user:u1',
      ],
    },
    {
      name: 'role create：只有 role:read',
      change: { resource: 'role', kind: 'create', id: 'r1' },
      rooms: ['t:t1:perm:auditLog:read', 't:t1:perm:role:read'],
    },
    {
      name: 'role update：role:read ＋ user:read（使用者嵌入角色名稱）',
      change: { resource: 'role', kind: 'update', id: 'r1' },
      rooms: ['t:t1:perm:auditLog:read', 't:t1:perm:role:read', 't:t1:perm:user:read'],
    },
    {
      name: 'role delete：role:read ＋ user:read',
      change: { resource: 'role', kind: 'delete', id: 'r1' },
      rooms: ['t:t1:perm:auditLog:read', 't:t1:perm:role:read', 't:t1:perm:user:read'],
    },
    {
      name: 'rolePermission：只有 role:read',
      change: { resource: 'rolePermission', kind: 'update', id: 'r1' },
      rooms: ['t:t1:perm:auditLog:read', 't:t1:perm:role:read'],
    },
    {
      name: 'userCredential：只有稽核的讀者（沒有畫面顯示憑證），也不推給本人',
      change: { resource: 'userCredential', kind: 'update', id: 'u1' },
      rooms: ['t:t1:perm:auditLog:read'],
    },
    {
      name: 'serviceAccount：只有 serviceAccount:read（docs/architecture/06-external-api.md §9.2 D14）',
      change: { resource: 'serviceAccount', kind: 'update', id: 's1' },
      rooms: ['t:t1:perm:auditLog:read', 't:t1:perm:serviceAccount:read'],
    },
    {
      name: 'apiToken：服務帳號的讀者與能管理使用者 token 的人（user:update）',
      change: { resource: 'apiToken', kind: 'create', id: 'k1' },
      rooms: ['t:t1:perm:auditLog:read', 't:t1:perm:serviceAccount:read', 't:t1:perm:user:update'],
    },
  ];

  it.each(cases)('$name', ({ change, rooms }) => {
    expect(sorted(resolveAudienceRooms([change]))).toEqual(sorted(rooms));
  });

  it('affectedUserIds（角色持有者）加進 user room', () => {
    const rooms = resolveAudienceRooms(
      [{ resource: 'rolePermission', kind: 'update', id: 'r1' }],
      ['u1', 'u2'],
    );
    expect(rooms).toContain('t:t1:user:u1');
    expect(rooms).toContain('t:t1:user:u2');
  });

  it('多筆變更的 room 取聯集且不重複', () => {
    const rooms = resolveAudienceRooms(
      [
        { resource: 'user', kind: 'update', id: 'u1' },
        { resource: 'userRole', kind: 'update', id: 'u1' },
      ],
      ['u1'],
    );
    expect(rooms.length).toBe(new Set(rooms).size);
  });

  it('notification：只推給收件人（affectedUserIds），不推 perm room，也不讓稽核的讀者重抓（docs/architecture/backend/15-notification.md §12.2 D8、D9）', () => {
    const rooms = resolveAudienceRooms(
      [{ resource: 'notification', kind: 'create', id: 'n1' }],
      ['u1'],
    );
    expect(rooms).toEqual(['t:t1:user:u1']);
  });

  it('notification 與會寫稽核的來源一起推：稽核的讀者照樣收到', () => {
    const rooms = resolveAudienceRooms(
      [
        { resource: 'notification', kind: 'create', id: 'n1' },
        { resource: 'userCredential', kind: 'update', id: 'u1' },
      ],
      ['u1'],
    );
    expect(sorted(rooms)).toEqual(['t:t1:perm:auditLog:read', 't:t1:user:u1']);
  });

  it('沒有變更就沒有受眾', () => {
    expect(resolveAudienceRooms([], ['u1'])).toEqual([]);
  });
});

describe('permRoomsFor', () => {
  it('一般使用者：只有持有的權限', () => {
    expect(permRoomsFor(new Set(['role:read'] as const), false)).toEqual(['t:t1:perm:role:read']);
  });

  it('super-admin：加入所有 perm room', () => {
    expect(permRoomsFor(new Set(), true)).toEqual([...allPermRooms()]);
  });
});

function setup(openRooms: Record<string, number>) {
  const permissionService = {
    getPermissionSets: vi.fn(
      async (ids: readonly string[]) =>
        new Map(
          ids.map((id) => [id, { permissions: new Set(['role:read']), isSuperAdmin: false }]),
        ),
    ),
  };
  const publisher = {
    countConnections: vi.fn((room: string) => openRooms[room] ?? 0),
    moveRooms: vi.fn(),
  };
  const audience = new RealtimeAudience(
    permissionService as unknown as PermissionService,
    publisher as unknown as RealtimePublisher,
  );
  return { audience, permissionService, publisher };
}

describe('RealtimeAudience.refreshAudience（§6.2）', () => {
  it('有連線的人：移出所有 perm room、再加入目前權限對應的', async () => {
    const { audience, publisher } = setup({ 't:t1:user:u1': 1 });

    await audience.refreshAudience(['u1', 'u1']);

    expect(publisher.moveRooms).toHaveBeenCalledTimes(1);
    expect(publisher.moveRooms).toHaveBeenCalledWith('t:t1:user:u1', allPermRooms(), [
      't:t1:perm:role:read',
    ]);
  });

  it('沒有連線的人不解析權限', async () => {
    const { audience, permissionService, publisher } = setup({});

    await audience.refreshAudience(['u2']);

    expect(permissionService.getPermissionSets).not.toHaveBeenCalled();
    expect(publisher.moveRooms).not.toHaveBeenCalled();
  });

  it('多人一起批次解析權限，不是每人各查一次', async () => {
    const { audience, permissionService, publisher } = setup({
      't:t1:user:u1': 1,
      't:t1:user:u2': 2,
    });

    await audience.refreshAudience(['u1', 'u2', 'u3']);

    expect(permissionService.getPermissionSets).toHaveBeenCalledTimes(1);
    expect(permissionService.getPermissionSets).toHaveBeenCalledWith(['u1', 'u2']);
    expect(publisher.moveRooms).toHaveBeenCalledTimes(2);
  });

  it('上千人分批解析，每批有上限', async () => {
    const ids = Array.from({ length: 450 }, (_, index) => `u${index}`);
    const { audience, permissionService, publisher } = setup(
      Object.fromEntries(ids.map((id) => [`t:t1:user:${id}`, 1])),
    );

    await audience.refreshAudience(ids);

    const batches = permissionService.getPermissionSets.mock.calls.map(([batch]) => batch.length);
    expect(batches).toEqual([200, 200, 50]);
    expect(publisher.moveRooms).toHaveBeenCalledTimes(450);
  });
});
