import { Module } from '@nestjs/common';

import { TenantFeatureImpacts } from '@/core/tenant';
import { ApprovalFlowService } from '@/modules/approval/approval-flow.service';
import { ApprovalModule } from '@/modules/approval/approval.module';
import { TrashModule } from '@/modules/trash/trash.module';

import { OrgAssigneeResolvers } from './org-assignee.resolvers';
import { OrgChartService } from './org-chart.service';
import { OrgUnitTrashHandler } from './org-unit-trash.handler';
import { OrgUnitController, UserOrgUnitController } from './org-unit.controller';
import { OrgUnitRepository } from './org-unit.repository';
import { OrgUnitService } from './org-unit.service';

/**
 * 組織管理（docs/architecture/backend/23-organization.md）：部門樹、成員、主管。
 * `OrgChartService` 給其他模組查主管與部門範圍；審批的 `manager`／`orgUnit` 規則由這裡登記進審批（§3）。
 */
@Module({
  imports: [TrashModule, ApprovalModule],
  controllers: [OrgUnitController, UserOrgUnitController],
  providers: [
    OrgUnitService,
    OrgUnitRepository,
    OrgChartService,
    OrgUnitTrashHandler,
    OrgAssigneeResolvers,
  ],
  exports: [OrgChartService],
})
export class OrganizationModule {
  constructor(
    impacts: TenantFeatureImpacts,
    repo: OrgUnitRepository,
    approvalFlows: ApprovalFlowService,
  ) {
    // 平台關閉 `organization` 前的確認框列出的數量（docs/architecture/backend/23-organization.md §6）：
    // 部門、有部門的人，以及用到主管規則的審批流程（那些關卡會找不到人）
    impacts.register('organization', async () => {
      const [impact, flows] = await Promise.all([repo.countImpact(), approvalFlows.countImpact()]);
      return {
        orgUnits: impact.units,
        orgUnitMembers: impact.members,
        approvalFlowsUsingOrg: flows.usingOrg,
      };
    });
  }
}
