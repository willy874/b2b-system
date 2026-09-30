import { createRoute } from '@tanstack/react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AppContext, AppDynamicPluginFactory } from '@/core/app';
import { RootRoute } from '@/core/router';
import { createCoreContext } from '@/shared/context';
import { createRegistry } from '@/shared/registry';

import { FeatureActivator } from '../FeatureActivator';
import { featureStore, findFeatureByPath, resetFeatureStore } from '../store';

const pages = createRegistry<string, string>('Page');
const FileRoute = createRoute({ getParentRoute: () => RootRoute, path: '/file' });
const JobRoute = createRoute({ getParentRoute: () => RootRoute, path: '/job' });

function plugin(name: string, onInit?: () => Promise<void>): AppDynamicPluginFactory {
  return () => {
    pages.register(name, name);
    return { name, onInit };
  };
}

function setup(catalogPlugins: { file?: AppDynamicPluginFactory; job?: AppDynamicPluginFactory }) {
  const context = createCoreContext() as unknown as AppContext;
  const beforeDisable = vi.fn();
  const onInstallError = vi.fn();
  const afterEnable = vi.fn();
  const activator = new FeatureActivator({
    context,
    catalog: {
      file: { plugin: catalogPlugins.file ?? plugin('file'), routes: [FileRoute] },
      job: { plugin: catalogPlugins.job ?? plugin('job'), routes: [JobRoute] },
    },
    beforeDisable,
    afterEnable,
    onInstallError,
  });
  return { activator, beforeDisable, afterEnable, onInstallError };
}

const statuses = () => Object.fromEntries(featureStore.getState().statuses);

describe('FeatureActivator（docs/adr/0021-runtime-feature-activation.md D8、D9）', () => {
  beforeEach(() => {
    pages.reset();
    resetFeatureStore();
  });

  it('套用清單前每個 feature 都未定；套用後依清單安裝', async () => {
    const { activator } = setup({});
    expect(featureStore.getState().resolved).toBe(false);

    await activator.apply(['file']);
    expect(featureStore.getState().resolved).toBe(true);
    expect(statuses()).toEqual({ file: 'ready', job: 'disabled' });
    expect(pages.keys()).toEqual(['file']);
  });

  it('清單移除的 feature 被卸載、撤回註冊，卸載前呼叫 beforeDisable', async () => {
    const { activator, beforeDisable } = setup({});
    await activator.apply(['file', 'job']);

    await activator.apply(['job']);
    expect(statuses()).toEqual({ file: 'disabled', job: 'ready' });
    expect(pages.keys()).toEqual(['job']);
    expect(beforeDisable).toHaveBeenCalledWith('file', ['/file']);
  });

  it('等 beforeDisable（離開頁面）完成才撤回註冊：頁面還掛著時不能少了權限註冊', async () => {
    const { activator, beforeDisable } = setup({});
    await activator.apply(['file']);
    let leave!: () => void;
    beforeDisable.mockImplementation(() => new Promise<void>((resolve) => (leave = resolve)));

    const applying = activator.apply([]);
    await Promise.resolve();
    expect(pages.keys()).toEqual(['file']);

    leave();
    await applying;
    expect(pages.keys()).toEqual([]);
  });

  it('停用後再啟用可以重新安裝，安裝完成後呼叫 afterEnable（讓停在 404 的頁面重新判斷）', async () => {
    const { activator, afterEnable } = setup({});
    await activator.apply(['file']);
    await activator.apply([]);
    afterEnable.mockClear();

    await activator.apply(['file']);
    expect(statuses().file).toBe('ready');
    expect(afterEnable).toHaveBeenCalledExactlyOnceWith('file', ['/file']);
  });

  it('清單相同時不重複安裝', async () => {
    const onInit = vi.fn(() => Promise.resolve());
    const { activator } = setup({ file: plugin('file', onInit) });

    await activator.apply(['file']);
    await activator.apply(['file']);
    expect(onInit).toHaveBeenCalledOnce();
  });

  it('安裝失敗只影響那一個 feature：狀態 failed、回報錯誤，其他照常安裝', async () => {
    const { activator, onInstallError } = setup({
      file: plugin('file', () => Promise.reject(new Error('boom'))),
    });

    await activator.apply(['file', 'job']);
    expect(statuses()).toEqual({ file: 'failed', job: 'ready' });
    expect(pages.keys()).toEqual(['job']);
    expect(onInstallError).toHaveBeenCalledWith('file', expect.any(Error));
  });

  it('不在 catalog 裡的 id 忽略', async () => {
    const { activator } = setup({});
    await activator.apply(['unknown', 'job']);

    expect(statuses()).toEqual({ file: 'disabled', job: 'ready' });
  });

  it('快速連續套用時依序執行，以最後一份清單為準', async () => {
    const { activator } = setup({});
    void activator.apply(['file']);
    void activator.apply([]);
    await activator.apply(['job']);

    expect(statuses()).toEqual({ file: 'disabled', job: 'ready' });
    expect(pages.keys()).toEqual(['job']);
  });
});

describe('findFeatureByPath', () => {
  const basePaths = new Map([['file', ['/file']]]);

  it.each([
    ['/file', 'file'],
    ['/file/abc', 'file'],
    ['/files', undefined],
    ['/user', undefined],
  ])('%s → %s', (pathname, expected) => {
    expect(findFeatureByPath(pathname, basePaths)).toBe(expected);
  });
});
