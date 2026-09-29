import type { ResourceChangeWire } from '@b2b-system/realtime';
import { describe, expect, it, vi } from 'vitest';

import type { PermissionService } from '@/modules/permission/permission.service';

import { RealtimeAudience, resolveAudienceRooms } from '../realtime.audience';
import type { RealtimePublisher } from '../realtime.publisher';
import { ALL_PERM_ROOMS, permRoomsFor } from '../realtime.rooms';

const sorted = (rooms: string[]) => rooms.toSorted();

describe('來源 → 受眾（docs/architecture/backend/08-realtime.md §6.1）', () => {
  const cases: Array<{ name: string; change: ResourceChangeWire; rooms: string[] }> = [
    {
      name: 'user：user:read、role:read 與被改的那個人',
      change: { resource: 'user', kind: 'update', id: 'u1' },
      rooms: ['perm:auditLog:read', 'perm:role:read', 'perm:user:read', 'user:u1'],
    },
    {
      name: 'userRole：user:read、role:read 與被指派的那個人',
      change: { resource: 'userRole', kind: 'update', id: 'u1', refs: { role: ['r1'] } },
      rooms: ['perm:auditLog:read', 'perm:role:read', 'perm:user:read', 'user:u1'],
    },
    {
      name: 'role create：只有 role:read',
      change: { resource: 'role', kind: 'create', id: 'r1' },
      rooms: ['perm:auditLog:read', 'perm:role:read'],
    },
    {
      name: 'role update：role:read ＋ user:read（使用者嵌入角色名稱）',
      change: { resource: 'role', kind: 'update', id: 'r1' },
      rooms: ['perm:auditLog:read', 'perm:role:read', 'perm:user:read'],
    },
    {
      name: 'role delete：role:read ＋ user:read',
      change: { resource: 'role', kind: 'delete', id: 'r1' },
      rooms: ['perm:auditLog:read', 'perm:role:read', 'perm:user:read'],
    },
    {
      name: 'rolePermission：只有 role:read',
      change: { resource: 'rolePermission', kind: 'update', id: 'r1' },
      rooms: ['perm:auditLog:read', 'perm:role:read'],
    },
    {
      name: 'userCredential：只有稽核的讀者（沒有畫面顯示憑證），也不推給本人',
      change: { resource: 'userCredential', kind: 'update', id: 'u1' },
      rooms: ['perm:auditLog:read'],
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
    expect(rooms).toContain('user:u1');
    expect(rooms).toContain('user:u2');
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

  it('沒有變更就沒有受眾', () => {
    expect(resolveAudienceRooms([], ['u1'])).toEqual([]);
  });
});

describe('工作區範圍的來源（docs/adr/0018-workspace-tenancy.md D16）', () => {
  it('file：只推給這個工作區持有 file:read / file:access 的連線', () => {
    const rooms = resolveAudienceRooms([{ resource: 'file', kind: 'update', id: 'f1' }], [], 'w1');
    expect(sorted(rooms)).toEqual(
      sorted(['perm:auditLog:read', 'ws:w1:perm:file:read', 'ws:w1:perm:file:access']),
    );
  });

  it('沒帶 workspaceId：不推給任何工作區的 room（寧可漏推也不跨工作區）', () => {
    const rooms = resolveAudienceRooms([{ resource: 'fileFolder', kind: 'create' }]);
    expect(rooms).toEqual(['perm:auditLog:read']);
  });

  it('workspaceMember：成員清單的讀者與本人', () => {
    const rooms = resolveAudienceRooms(
      [{ resource: 'workspaceMember', kind: 'update', id: 'u1' }],
      [],
      'w1',
    );
    expect(sorted(rooms)).toEqual(
      sorted(['perm:auditLog:read', 'ws:w1:perm:workspaceMember:read', 'user:u1']),
    );
  });

  it('workspace：平台的 workspace:read 與成員（affectedUserIds）', () => {
    const rooms = resolveAudienceRooms(
      [{ resource: 'workspace', kind: 'update', id: 'w1' }],
      ['u1'],
    );
    expect(sorted(rooms)).toEqual(sorted(['perm:auditLog:read', 'perm:workspace:read', 'user:u1']));
  });
});

describe('permRoomsFor', () => {
  it('一般使用者：只有持有的權限', () => {
    expect(permRoomsFor(new Set(['role:read'] as const), false)).toEqual(['perm:role:read']);
  });

  it('super-admin：加入所有 perm room', () => {
    expect(permRoomsFor(new Set(), true)).toEqual([...ALL_PERM_ROOMS]);
  });

  it('工作區範圍的鍵不會變成平台的 perm room', () => {
    expect(permRoomsFor(new Set(['role:read', 'file:read'] as const), false)).toEqual([
      'perm:role:read',
    ]);
  });
});

function setup(
  openRooms: Record<string, number>,
  options: { workspaceIds?: string[]; joined?: string[]; canEnter?: boolean } = {},
) {
  const permissionService = {
    getPermissionSet: vi.fn(async () => ({
      permissions: new Set(['role:read']),
      isSuperAdmin: false,
      canEnter: true,
    })),
    findMemberWorkspaceIds: vi.fn(async () => options.workspaceIds ?? []),
    getWorkspacePermissionSet: vi.fn(async () => ({
      permissions: new Set(['role:read', 'file:access']),
      isSuperAdmin: false,
      canEnter: options.canEnter ?? true,
    })),
  };
  const publisher = {
    countConnections: vi.fn((room: string) => openRooms[room] ?? 0),
    moveRooms: vi.fn(),
    roomsOf: vi.fn(() => options.joined ?? []),
  };
  const audience = new RealtimeAudience(
    permissionService as unknown as PermissionService,
    publisher as unknown as RealtimePublisher,
  );
  return { audience, permissionService, publisher };
}

describe('RealtimeAudience（§6.2；docs/adr/0018-workspace-tenancy.md D16）', () => {
  it('新連線：平台的 perm room ＋ 所屬每個工作區的 perm room', async () => {
    const { audience } = setup({}, { workspaceIds: ['w1', 'w2'] });
    expect(sorted(await audience.roomsFor('u1'))).toEqual(
      sorted(['perm:role:read', 'ws:w1:perm:file:access', 'ws:w2:perm:file:access']),
    );
  });

  it('有連線的人：移出所有 perm room、再加入目前權限對應的', async () => {
    const { audience, publisher } = setup({ 'user:u1': 1 });

    await audience.refreshAudience(['u1', 'u1']);

    expect(publisher.moveRooms).toHaveBeenCalledTimes(1);
    expect(publisher.moveRooms).toHaveBeenCalledWith('user:u1', ALL_PERM_ROOMS, ['perm:role:read']);
  });

  it('被移出的工作區：連線目前在的那些 room 也一併移出', async () => {
    const { audience, publisher } = setup(
      { 'user:u1': 1 },
      { workspaceIds: [], joined: ['user:u1', 'perm:role:read', 'ws:w1:perm:file:access'] },
    );

    await audience.refreshAudience(['u1']);

    const [, leave, join] = publisher.moveRooms.mock.calls[0] as [string, string[], string[]];
    expect(leave).toContain('ws:w1:perm:file:access');
    expect(leave).not.toContain('user:u1');
    expect(join).toEqual(['perm:role:read']);
  });

  it('沒有連線的人不解析權限', async () => {
    const { audience, permissionService, publisher } = setup({});

    await audience.refreshAudience(['u2']);

    expect(permissionService.getPermissionSet).not.toHaveBeenCalled();
    expect(publisher.moveRooms).not.toHaveBeenCalled();
  });
});
