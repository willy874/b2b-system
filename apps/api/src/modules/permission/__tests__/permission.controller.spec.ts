import { Reflector } from '@nestjs/core';
import { describe, expect, it, vi } from 'vitest';

import { REQUIRED_PERMISSIONS } from '@/common/decorators';

import { PermissionController } from '../permission.controller';
import type { PermissionService } from '../permission.service';

describe('PermissionController（docs/architecture/iam/02-permission-catalog.md）', () => {
  it('GET /permissions 回傳權限目錄', async () => {
    const catalog = { items: [], groups: [] };
    const service = { getCatalog: vi.fn().mockResolvedValue(catalog) };
    const controller = new PermissionController(service as unknown as PermissionService);
    await expect(controller.list()).resolves.toBe(catalog);
  });

  it('需要 permission:read', () => {
    const requirement = new Reflector().get(
      REQUIRED_PERMISSIONS,
      PermissionController.prototype.list,
    );
    expect(requirement).toEqual({ keys: ['permission:read'], match: 'every' });
  });
});
