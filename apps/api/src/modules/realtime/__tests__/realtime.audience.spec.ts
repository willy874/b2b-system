import type { ResourceChangeWire } from '@game-editor/realtime';
import { describe, expect, it } from 'vitest';

import { resolveAudienceRooms } from '../realtime.audience';
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

describe('permRoomsFor', () => {
  it('一般使用者：只有持有的權限', () => {
    expect(permRoomsFor(new Set(['role:read'] as const), false)).toEqual(['perm:role:read']);
  });

  it('super-admin：加入所有 perm room', () => {
    expect(permRoomsFor(new Set(), true)).toEqual([...ALL_PERM_ROOMS]);
  });
});
