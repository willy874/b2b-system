import { usePermissionStore } from '@b2b-system/web-core/store';
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';

import type { PermissionKey } from '@/core/permission';

import { partitionFileActionTargets, registerFileAction, useFileActions } from '../actions';
import type { FileActionDefinition, FileActionTarget } from '../actions';
import { resetFileRegistry } from '../registry';

const Noop = () => null;

const action = (
  overrides: Partial<FileActionDefinition> & { id: string },
): FileActionDefinition => ({
  labelKey: 'test.action',
  icon: 'file-image',
  placement: ['selectionBar', 'lightbox'],
  component: Noop,
  ...overrides,
});

function hydrate(keys: string[]): void {
  usePermissionStore.setState({ permissions: new Set(keys as PermissionKey[]), hydrated: true });
}

const ids = (actions: readonly FileActionDefinition[]) => actions.map((entry) => entry.id);

const target = (id: string, contentType = 'image/png'): FileActionTarget => ({
  id,
  name: `${id}.png`,
  contentType,
  size: 1,
});

beforeEach(() => {
  resetFileRegistry();
  hydrate([]);
});

describe('registerFileAction／useFileActions（檔案動作的擴充點，docs/architecture/frontend/12-file-manager.md §6.2）', () => {
  it('依 order 排序，只列出這個位置的動作', () => {
    registerFileAction(action({ id: 'b', order: 20 }));
    registerFileAction(action({ id: 'a', order: 10 }));
    registerFileAction(action({ id: 'lightbox-only', placement: ['lightbox'] }));
    const { result } = renderHook(() => useFileActions('selectionBar'));
    expect(ids(result.current)).toEqual(['a', 'b']);
  });

  it('isAvailable 以權限過濾', () => {
    registerFileAction(
      action({ id: 'allowed', isAvailable: ({ can }) => can('file:read' as PermissionKey) }),
    );
    registerFileAction(
      action({ id: 'denied', isAvailable: ({ can }) => can('role:read' as PermissionKey) }),
    );
    hydrate(['file:read']);
    const { result } = renderHook(() => useFileActions('selectionBar'));
    expect(ids(result.current)).toEqual(['allowed']);
  });

  it('權限未水合時不列出任何動作（按鈕不閃現）', () => {
    registerFileAction(action({ id: 'a' }));
    usePermissionStore.setState({ permissions: new Set(), hydrated: false });
    const { result } = renderHook(() => useFileActions('selectionBar'));
    expect(result.current).toEqual([]);
  });

  it('訂閱註冊表：登記與反註冊（feature 執行期卸載）都即時反映', () => {
    const { result } = renderHook(() => useFileActions('lightbox'));
    expect(result.current).toEqual([]);
    let dispose: (() => void) | undefined;
    act(() => {
      dispose = registerFileAction(action({ id: 'gallery.add' }));
    });
    expect(ids(result.current)).toEqual(['gallery.add']);
    act(() => dispose?.());
    expect(result.current).toEqual([]);
  });

  it('同一個 id 重複登記丟例外', () => {
    registerFileAction(action({ id: 'a' }));
    expect(() => registerFileAction(action({ id: 'a' }))).toThrow('already registered');
  });

  it('resetFileRegistry 一併清掉檔案動作', () => {
    registerFileAction(action({ id: 'a' }));
    resetFileRegistry();
    const { result } = renderHook(() => useFileActions('selectionBar'));
    expect(result.current).toEqual([]);
    expect(() => registerFileAction(action({ id: 'a' }))).not.toThrow();
  });
});

describe('partitionFileActionTargets（以 check 分出可處理與略過的檔案）', () => {
  it('沒有 check → 全部可以處理', () => {
    expect(partitionFileActionTargets({}, [target('a'), target('b')])).toEqual({
      files: [target('a'), target('b')],
      skipped: [],
    });
  });

  it('不通過的帶原因放進 skipped，順序不變', () => {
    const result = partitionFileActionTargets(
      {
        check: (file) =>
          file.contentType.startsWith('image/')
            ? { ok: true }
            : { ok: false, reasonKey: 'test.notImage', params: { name: file.name } },
      },
      [target('a'), target('b', 'text/plain'), target('c')],
    );
    expect(result.files.map((file) => file.id)).toEqual(['a', 'c']);
    expect(result.skipped).toEqual([
      { file: target('b', 'text/plain'), reasonKey: 'test.notImage', params: { name: 'b.png' } },
    ]);
  });
});
