import { describe, expect, it, vi } from 'vitest';

import type { Database } from '@/core/database';
import { runInTenantContext } from '@/core/tenant';

import type { FolderNode } from '../file-access.context';
import { FileFolderTree } from '../file-folder-tree';
import type { FileFolderRepository } from '../file-folder.repository';

function node(id: string): FolderNode {
  return { id, parentId: null, inheritGrants: true, createdBy: null };
}

/** 由測試決定何時完成的 Promise（模擬還在跑的查詢）。 */
function deferred<T>() {
  const resolvers: ((value: T) => void)[] = [];
  const promise = new Promise<T>((done) => {
    resolvers.push(done);
  });
  return { promise, resolve: (value: T) => resolvers[0]?.(value) };
}

function setup() {
  let current: FolderNode[] = [node('a')];
  const repo = {
    listTreeNodes: vi.fn(async (_tx?: unknown) => current),
    lockTree: vi.fn(async () => undefined),
  };
  // withTransaction(db, fn) 只呼叫 db.transaction(fn)
  const db = { transaction: vi.fn(async (fn: (tx: unknown) => unknown) => fn('tx')) };
  const tree = new FileFolderTree(
    db as unknown as Database,
    repo as unknown as FileFolderRepository,
  );
  return {
    tree,
    repo,
    replace: (nodes: FolderNode[]) => {
      current = nodes;
    },
  };
}

const inTenant = <T>(id: string, fn: () => T) =>
  runInTenantContext(
    {
      id,
      code: id,
      db: {} as Database,
      storageBucket: id,
      allowExternalIdp: true,
      features: ['file', 'auditLog', 'job'],
    },
    fn,
  );

describe('FileFolderTree（資料夾結構的程序內快取）', () => {
  it('交易外的讀取共用快取：連續兩個請求只查一次資料庫', async () => {
    const { tree, repo } = setup();
    await tree.nodes();
    await expect(tree.nodes()).resolves.toEqual([node('a')]);
    expect(repo.listTreeNodes).toHaveBeenCalledTimes(1);
  });

  it('交易內的讀取一律直接查（持有樹鎖時要看到最新的結構）', async () => {
    const { tree, repo } = setup();
    await tree.nodes();
    await tree.nodes('tx' as never);
    expect(repo.listTreeNodes).toHaveBeenCalledTimes(2);
    expect(repo.listTreeNodes).toHaveBeenLastCalledWith('tx');
  });

  it('write：交易內先取樹鎖，提交後失效，下一次讀到新結構', async () => {
    const { tree, repo, replace } = setup();
    await tree.nodes();
    await tree.write(async () => {
      expect(repo.lockTree).toHaveBeenCalledWith('tx');
      replace([node('a'), node('b')]);
    });
    await expect(tree.nodes()).resolves.toEqual([node('a'), node('b')]);
  });

  it('write 失敗（rollback）也失效：多查一次無害', async () => {
    const { tree, repo } = setup();
    await tree.nodes();
    await expect(
      tree.write(async () => {
        throw new Error('rollback');
      }),
    ).rejects.toThrow('rollback');
    await tree.nodes();
    expect(repo.listTreeNodes).toHaveBeenCalledTimes(2);
  });

  it('寫入提交前開始的讀取不會在失效之後留在快取', async () => {
    const { tree, repo, replace } = setup();
    const pending = deferred<FolderNode[]>();
    repo.listTreeNodes.mockImplementationOnce(() => pending.promise);
    const stale = tree.nodes();
    await tree.write(async () => replace([node('b')]));
    pending.resolve([node('a')]);
    await expect(stale).resolves.toEqual([node('a')]);
    await expect(tree.nodes()).resolves.toEqual([node('b')]);
  });

  it('查詢失敗不留在快取', async () => {
    const { tree, repo } = setup();
    repo.listTreeNodes.mockRejectedValueOnce(new Error('db down'));
    await expect(tree.nodes()).rejects.toThrow('db down');
    await expect(tree.nodes()).resolves.toEqual([node('a')]);
  });

  it('快取以租戶區分：A 租戶的寫入不影響 B 租戶的快取，也不會拿到別人的結構', async () => {
    const { tree, repo } = setup();
    repo.listTreeNodes.mockImplementation(async () => [
      node(`root-${repo.listTreeNodes.mock.calls.length}`),
    ]);
    const a = await inTenant('acme', () => tree.nodes());
    const b = await inTenant('beta', () => tree.nodes());
    expect(a).not.toEqual(b);
    await inTenant('acme', () => tree.write(async () => undefined));
    await expect(inTenant('beta', () => tree.nodes())).resolves.toEqual(b);
    expect(repo.listTreeNodes).toHaveBeenCalledTimes(2);
  });
});
