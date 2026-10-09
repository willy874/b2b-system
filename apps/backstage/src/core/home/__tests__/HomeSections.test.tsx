import { renderUnhydrated, renderWithPermissions } from '@b2b-system/web-core/testing';
import { screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';

import type { PermissionKey } from '@/core/permission';
import {
  definePageKey,
  PermissionMatch,
  registerPagePermission,
  resetPagePermissionRegistry,
} from '@/core/permission';

import { HomeSections } from '../HomeSections';
import { registerHomeSection, resetHomeSections } from '../registry';

const OPEN = definePageKey('TEST_HOME_OPEN');
const AUDIT = definePageKey('TEST_HOME_AUDIT');

describe('HomeSections（首頁的區塊，docs/architecture/frontend/02-plugin-system.md §4.7）', () => {
  beforeEach(() => {
    resetHomeSections();
    resetPagePermissionRegistry();
    registerPagePermission(OPEN, {
      route: '/test-open',
      rule: { access: [], match: PermissionMatch.EVERY },
    });
    registerPagePermission(AUDIT, {
      route: '/test-audit',
      rule: { access: ['auditLog:read' as PermissionKey], match: PermissionMatch.EVERY },
    });
    registerHomeSection({
      key: 'second',
      pageKey: OPEN,
      order: 200,
      Section: () => <p data-testid="home-section">second</p>,
    });
    registerHomeSection({
      key: 'first',
      pageKey: OPEN,
      order: 100,
      Section: () => <p data-testid="home-section">first</p>,
    });
    registerHomeSection({
      key: 'audit',
      pageKey: AUDIT,
      order: 50,
      Section: () => <p data-testid="home-section">audit</p>,
    });
  });

  it('依 order 排出有權限的區塊', () => {
    renderWithPermissions(<HomeSections />, []);
    expect(screen.getAllByTestId('home-section').map((node) => node.textContent)).toEqual([
      'first',
      'second',
    ]);
  });

  it('有權限的區塊才出現', () => {
    renderWithPermissions(<HomeSections />, ['auditLog:read' as PermissionKey]);
    expect(screen.getAllByTestId('home-section')[0]).toHaveTextContent('audit');
  });

  it('權限未水合 → 不渲染任何區塊', () => {
    renderUnhydrated(<HomeSections />);
    expect(screen.queryByTestId('home-section')).toBeNull();
  });
});
