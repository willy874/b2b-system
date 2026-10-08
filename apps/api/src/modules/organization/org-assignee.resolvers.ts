import { Injectable } from '@nestjs/common';
import type { OnModuleInit } from '@nestjs/common';

import type { DbOrTx } from '@/core/database';
import { ApprovalService } from '@/modules/approval/approval.service';

import { OrgChartService } from './org-chart.service';

/**
 * 組織管理登記進審批的兩種審核者規則（docs/architecture/backend/20-approval.md §9.2、D15）：
 * `manager`（申請人的第 N 層主管）與 `orgUnit`（某部門的主管）。`organization` 未啟用時不可用、展開為空（D14）。
 */
@Injectable()
export class OrgAssigneeResolvers implements OnModuleInit {
  constructor(
    private readonly approvals: ApprovalService,
    private readonly orgChart: OrgChartService,
  ) {}

  onModuleInit(): void {
    this.approvals.registerAssigneeResolver({
      kind: 'manager',
      isAvailable: () => this.orgChart.isEnabled(),
      resolve: async (rule, ctx, tx?: DbOrTx) =>
        ctx.requesterId ? this.orgChart.managersOf(ctx.requesterId, rule.level, tx) : [],
      // 沒有固定的對象：前端依層數顯示
      describe: async () => null,
    });
    this.approvals.registerAssigneeResolver({
      kind: 'orgUnit',
      isAvailable: () => this.orgChart.isEnabled(),
      resolve: (rule, _ctx, tx?: DbOrTx) => this.orgChart.managersOfUnit(rule.id, tx),
      describe: async (rule) => {
        const unit = (await this.orgChart.findNames([rule.id])).get(rule.id);
        return unit ? { label: unit.name, deleted: unit.deleted } : { label: '', deleted: true };
      },
    });
  }
}
