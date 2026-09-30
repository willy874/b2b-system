import { Inject, Injectable } from '@nestjs/common';

import type { Database, DbOrTx } from '@/core/database';
import { TENANT_DB, withTransaction } from '@/core/database';
import { currentTenant } from '@/core/tenant';

import type { FolderNode } from './file-access.context';
import { FileFolderRepository } from './file-folder.repository';

/**
 * 保險用的存活時間：所有結構寫入都經過 `write()` 並在提交後失效，這只是防漏網的上限
 * （例：有人直接改資料庫）。
 */
const TREE_TTL_MS = 60_000;
/** 租戶數的上限（異常時不無限成長）；一個租戶一筆。 */
const MAX_TENANTS = 1_000;

interface Entry {
  expiresAt: number;
  nodes: Promise<FolderNode[]>;
}

/**
 * 資料夾結構（解析授權用的四個欄位）的讀取與寫入（docs/architecture/backend/09-file.md §11.1）。
 *
 * 每個檔案請求都要整棵結構，而結構只在建立、移動、刪除、中斷繼承時改變，所以以「租戶」為 key
 * 快取在程序內。結構的寫入一律經過 `write()`：交易內先取樹鎖，**提交後** 才失效——失效早於提交的話，
 * 並行的讀取會把舊結構重新放回快取。失效時連同進行中的讀取一起丟掉，之後的請求重新查。
 *
 * 交易內（持有樹鎖、檢查與寫入之間結構不能變）的讀取一律直接查資料庫，不用快取。
 */
@Injectable()
export class FileFolderTree {
  private readonly entries = new Map<string, Entry>();

  constructor(
    @Inject(TENANT_DB) private readonly db: Database,
    private readonly repo: FileFolderRepository,
  ) {}

  /** 整棵結構。帶 `tx` 時直接查（交易內要看到自己的寫入與鎖住的狀態）。 */
  nodes(tx?: DbOrTx): Promise<FolderNode[]> {
    if (tx) return this.repo.listTreeNodes(tx);
    const tenant = tenantKey();
    const cached = this.entries.get(tenant);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.nodes;
    }

    const nodes = this.repo.listTreeNodes();
    const entry: Entry = { expiresAt: Date.now() + TREE_TTL_MS, nodes };
    if (!this.entries.has(tenant) && this.entries.size >= MAX_TENANTS) {
      const oldest = this.entries.keys().next();
      if (!oldest.done) this.entries.delete(oldest.value);
    }
    this.entries.set(tenant, entry);
    // 查詢失敗不留在快取，下一次重新查
    nodes.catch(() => {
      if (this.entries.get(tenant) === entry) this.entries.delete(tenant);
    });
    return nodes;
  }

  /**
   * 結構的寫入：交易內先取樹鎖（與其他結構寫入排隊，docs/architecture/backend/09-file.md §4.2），
   * 交易結束後失效快取（rollback 時也失效：多查一次無害）。
   */
  async write<T>(work: (tx: DbOrTx) => Promise<T>): Promise<T> {
    try {
      return await withTransaction(this.db, async (tx) => {
        await this.repo.lockTree(tx);
        return work(tx);
      });
    } finally {
      this.invalidate();
    }
  }

  /** 目前租戶的快取作廢（含進行中的讀取：它可能讀到提交前的結構）。 */
  invalidate(): void {
    this.entries.delete(tenantKey());
  }
}

/** 一個程序服務所有租戶：key 一定要帶租戶（docs/adr/0020-physical-tenant-isolation.md D17）。 */
function tenantKey(): string {
  return currentTenant()?.id ?? '-';
}
