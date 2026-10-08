import { Injectable } from '@nestjs/common';

import type { DbOrTx } from '@/core/database';
import { requireTenant } from '@/core/tenant';

import { OrgUnitRepository } from './org-unit.repository';

/**
 * 組織架構的唯讀查詢，給其他模組呼叫（審批的 `manager`／`orgUnit` 規則、使用者列表的部門篩選；
 * docs/architecture/backend/23-organization.md §3）。
 *
 * `organization` 未啟用時一律回空集合（D2）：呼叫端只需要處理「找不到」一種情況——組織架構本來就可能不完整。
 */
@Injectable()
export class OrgChartService {
  constructor(private readonly repo: OrgUnitRepository) {}

  /** 目前的租戶是否啟用組織管理。 */
  isEnabled(): boolean {
    return requireTenant().features.includes('organization');
  }

  /**
   * 某人的第 `level` 層主管（1 = 直屬；docs/architecture/backend/23-organization.md §3、D5）。
   *
   * 從他的 **主要部門** 往上走：第 1 層是第一個「有主管、而且主管不只他自己」的部門的主管（扣掉他自己），
   * 第 2 層從那個部門的上層繼續往上找下一組主管，依此類推。只算 `active`、未刪除的人類帳號。
   * 沒有主要部門、走到最上層還沒找到、或組織管理未啟用 → 空陣列。
   */
  async managersOf(userId: string, level: number, tx?: DbOrTx): Promise<string[]> {
    if (level < 1 || !this.isEnabled()) return [];
    const chain = await this.repo.managerChainOfUser(userId, userId, tx);
    const levels = chain.filter((step) => step.managerIds.length > 0);
    return levels[level - 1]?.managerIds ?? [];
  }

  /** 某部門的主管（只看這個部門，不往上找）。部門不存在、已刪除、或組織管理未啟用 → 空陣列。 */
  async managersOfUnit(unitId: string, tx?: DbOrTx): Promise<string[]> {
    if (!this.isEnabled()) return [];
    return this.repo.managersOfUnit(unitId, tx);
  }

  /** 部門（與它所有下層）的 id；不存在或已刪除時是空陣列。使用者列表的篩選用。 */
  async unitScope(unitId: string, includeDescendants: boolean): Promise<string[]> {
    const unit = await this.repo.findById(unitId);
    if (!unit) return [];
    if (!includeDescendants) return [unit.id];
    return (await this.repo.descendants(unit.id)).map((row) => row.id);
  }

  /** 部門的顯示名稱（含已刪除的）：審批規則的名稱快照與狀態。 */
  findNames(ids: readonly string[]): Promise<Map<string, { name: string; deleted: boolean }>> {
    return this.repo.findNames(ids);
  }
}
