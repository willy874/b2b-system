import { createRootRoute, createRoute } from '@tanstack/react-router';
import { beforeEach, describe, expect, it } from 'vitest';

import { collectRegistrations } from '@/shared/registry';

import { registerRouteLink, resetRouteLinkRegistry, resolveRouteLink } from '../registry';

const root = createRootRoute();
const approvalList = createRoute({ getParentRoute: () => root, path: '/approval' });
const approvalDetail = createRoute({ getParentRoute: () => approvalList, path: '$approvalId' });
const fileList = createRoute({ getParentRoute: () => root, path: '/file' });
const profile = createRoute({ getParentRoute: () => root, path: '/profile' });

describe('route id 註冊表（docs/architecture/backend/15-notification.md §12.2 D3）', () => {
  beforeEach(() => resetRouteLinkRegistry());

  it('path 參數：解析成完整的 path 樣板與參數', () => {
    registerRouteLink('approval.detail', {
      route: approvalDetail,
      params: { approvalId: 'approvalId' },
    });
    expect(resolveRouteLink({ route: 'approval.detail', params: { approvalId: 'a1' } })).toEqual({
      to: '/approval/$approvalId',
      params: { approvalId: 'a1' },
      search: {},
    });
  });

  it('search 參數：連結參數換成網址的 search，多出來的參數忽略', () => {
    registerRouteLink('file.folder', { route: fileList, search: { folder: 'folderId' } });
    expect(
      resolveRouteLink({ route: 'file.folder', params: { folderId: 'f1', other: 'x' } }),
    ).toEqual({ to: '/file', params: {}, search: { folder: 'f1' } });
  });

  it('沒有參數的頁面', () => {
    registerRouteLink('account.profile', { route: profile });
    expect(resolveRouteLink({ route: 'account.profile', params: {} })).toEqual({
      to: '/profile',
      params: {},
      search: {},
    });
  });

  it('沒有連結、沒有登記的 route id → 不可點（undefined）', () => {
    expect(resolveRouteLink(null)).toBeUndefined();
    expect(resolveRouteLink(undefined)).toBeUndefined();
    expect(resolveRouteLink({ route: 'unknown.page', params: {} })).toBeUndefined();
  });

  it('缺少必要參數、參數不是字串或是空字串 → 不可點', () => {
    registerRouteLink('approval.detail', {
      route: approvalDetail,
      params: { approvalId: 'approvalId' },
    });
    registerRouteLink('file.folder', { route: fileList, search: { folder: 'folderId' } });
    expect(resolveRouteLink({ route: 'approval.detail', params: {} })).toBeUndefined();
    expect(
      resolveRouteLink({ route: 'approval.detail', params: { approvalId: 1 } }),
    ).toBeUndefined();
    expect(resolveRouteLink({ route: 'file.folder', params: { folderId: '' } })).toBeUndefined();
  });

  it('同一個 id 登記兩次丟例外', () => {
    registerRouteLink('account.profile', { route: profile });
    expect(() => registerRouteLink('account.profile', { route: profile })).toThrow(
      'account.profile',
    );
  });

  it('id 格式不對丟例外（與後端的 route id 格式相同）', () => {
    expect(() => registerRouteLink('profile', { route: profile })).toThrow('格式');
    expect(() => registerRouteLink('Account.profile', { route: profile })).toThrow('格式');
    expect(() => registerRouteLink('account-profile.page', { route: profile })).toThrow('格式');
  });

  it('params 與 path 的 $參數對不上丟例外', () => {
    expect(() => registerRouteLink('approval.detail', { route: approvalDetail })).toThrow('對不上');
    expect(() =>
      registerRouteLink('account.profile', { route: profile, params: { userId: 'userId' } }),
    ).toThrow('對不上');
  });

  it('plugin 卸載時撤回登記：連結變成不可點，之後可以重新登記', () => {
    const { dispose } = collectRegistrations(() =>
      registerRouteLink('file.folder', { route: fileList, search: { folder: 'folderId' } }),
    );
    const link = { route: 'file.folder', params: { folderId: 'f1' } };
    expect(resolveRouteLink(link)).toBeDefined();
    dispose();
    expect(resolveRouteLink(link)).toBeUndefined();
    registerRouteLink('file.folder', { route: fileList, search: { folder: 'folderId' } });
    expect(resolveRouteLink(link)).toBeDefined();
  });
});
