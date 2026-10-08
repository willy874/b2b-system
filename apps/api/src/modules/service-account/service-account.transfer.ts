import { Injectable } from '@nestjs/common';
import type { OnModuleInit } from '@nestjs/common';
import { z } from 'zod';

import { PERMISSION } from '@/common/types';
import { DataTransferRegistry } from '@/modules/data-transfer/data-transfer-registry.service';
import { DATA_TRANSFER_EXPORT_PAGE_SIZE } from '@/modules/data-transfer/data-transfer.constants';
import { defineTransferResource } from '@/modules/data-transfer/data-transfer.definition';
import type { ExportScope } from '@/modules/data-transfer/data-transfer.types';

import { ListServiceAccountSchema } from './dto/service-account.dto';
import type {
  ServiceAccountExportCursor,
  ServiceAccountExportScope,
  ServiceAccountRow,
} from './service-account.repository';
import { ServiceAccountRepository } from './service-account.repository';

const ServiceAccountExportFilterSchema = ListServiceAccountSchema.omit({
  offset: true,
  limit: true,
  sort: true,
});
type ServiceAccountExportFilter = z.infer<typeof ServiceAccountExportFilterSchema>;

function toScope(scope: ExportScope<ServiceAccountExportFilter>): ServiceAccountExportScope {
  return scope.kind === 'ids' ? { ids: scope.ids } : { filter: scope.filter };
}

/**
 * 服務帳號的匯出（docs/architecture/backend/22-data-transfer.md §12.6；只匯出）：盤點有哪些整合、各持有什麼角色、還有幾把有效的 token。
 * 不提供匯入：建立服務帳號之後要另外簽發 token（只顯示一次），整批建立沒有意義。token 本身不匯出。
 */
@Injectable()
export class ServiceAccountTransferResource implements OnModuleInit {
  constructor(
    private readonly registry: DataTransferRegistry,
    private readonly repo: ServiceAccountRepository,
  ) {}

  onModuleInit(): void {
    this.registry.register(
      defineTransferResource<ServiceAccountExportFilter, ServiceAccountRow>({
        type: 'serviceAccount',
        feature: 'externalApi',
        fileBaseName: 'service-accounts',
        label: { 'zh-TW': '服務帳號', 'en-US': 'Service accounts' },
        columns: [
          {
            key: 'id',
            label: { 'zh-TW': 'ID', 'en-US': 'ID' },
            kind: 'string',
            export: { get: (account) => account.id },
          },
          {
            key: 'name',
            label: { 'zh-TW': '名稱', 'en-US': 'Name' },
            kind: 'string',
            export: { get: (account) => account.displayName },
          },
          {
            key: 'status',
            label: { 'zh-TW': '狀態', 'en-US': 'Status' },
            kind: 'enum',
            enum: [
              { value: 'active', label: { 'zh-TW': '啟用', 'en-US': 'Active' } },
              { value: 'inactive', label: { 'zh-TW': '停用', 'en-US': 'Inactive' } },
            ],
            export: { get: (account) => account.status },
          },
          {
            key: 'roles',
            label: { 'zh-TW': '角色', 'en-US': 'Roles' },
            kind: 'string',
            multiple: {},
            permission: PERMISSION.ROLE_READ,
            export: { get: (account) => account.roles.map((role) => role.name) },
          },
          {
            key: 'activeTokenCount',
            label: { 'zh-TW': '有效的 token 數', 'en-US': 'Active tokens' },
            kind: 'number',
            export: { get: (account) => account.activeTokenCount },
          },
          {
            key: 'createdAt',
            label: { 'zh-TW': '建立時間', 'en-US': 'Created at' },
            kind: 'datetime',
            export: { get: (account) => account.createdAt },
          },
        ],
        exporter: {
          permissions: [PERMISSION.SERVICE_ACCOUNT_EXPORT],
          filterSchema: ServiceAccountExportFilterSchema,
          idSchema: z.string().uuid(),
          orderHint: { 'zh-TW': '依建立時間排序', 'en-US': 'Sorted by creation time' },
          iterate: (scope) => this.iterate(scope),
          count: (scope) => this.repo.exportCount(toScope(scope)),
        },
      }),
    );
  }

  private async *iterate(
    scope: ExportScope<ServiceAccountExportFilter>,
  ): AsyncIterable<readonly ServiceAccountRow[]> {
    let after: ServiceAccountExportCursor | null = null;
    for (;;) {
      const page = await this.repo.exportPage(
        toScope(scope),
        after,
        DATA_TRANSFER_EXPORT_PAGE_SIZE,
      );
      if (page.length) yield page;
      const last = page.at(-1);
      if (!last || page.length < DATA_TRANSFER_EXPORT_PAGE_SIZE) return;
      after = { createdAt: last.createdAt, id: last.id };
    }
  }
}
