import { createParamDecorator, Injectable } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';

import type { AuthUser, PermissionKey } from '@/common/types';
import { AppException } from '@/core/errors';
import { runWithRequestContext } from '@/core/http';
import { DEFAULT_TIMEZONE_SETTING, isTimeZone, SettingService } from '@/core/settings';
import type { DataTransferRow } from '@/db/schema';
import { PermissionService } from '@/modules/permission/permission.service';

import { DataTransferRepository } from './data-transfer.repository';
import { TRANSFER_LOCALES } from './data-transfer.types';
import type { TransferContext, TransferLocale } from './data-transfer.types';

/** 前端每個請求帶的介面語系與時區（`web-core/plugins/fetcher/client-preference.ts`）。 */
export interface ClientPreference {
  locale: string | null;
  timezone: string | null;
}

/** 取請求的 `accept-language`、`x-client-timezone`：欄位名稱、選項、檔名依請求的語系（§4.2）。 */
export const RequestPreference = createParamDecorator(
  (_data: unknown, context: ExecutionContext): ClientPreference => {
    const request = context.switchToHttp().getRequest<Request>();
    const header = (name: string): string | null => {
      const value = request.headers[name];
      return typeof value === 'string' && value.trim() ? value.trim() : null;
    };
    return { locale: header('accept-language'), timezone: header('x-client-timezone') };
  },
);

/** 未設定或不支援的語系一律退回繁中（系統預設）。 */
export function toTransferLocale(value: string | null | undefined): TransferLocale | null {
  if (!value) return null;
  const first = value.split(',')[0]?.split(';')[0]?.trim().toLowerCase() ?? '';
  return TRANSFER_LOCALES.find((locale) => locale.toLowerCase() === first) ?? null;
}

/** 永遠不會中止的 signal：請求內的分析與驗證不受取消影響。 */
const NEVER = new AbortController().signal;

/** 工作的建立者已被停用、刪除：整個傳輸 `failed`（§4「failed 只表示整個傳輸無法進行」）。 */
export class TransferOwnerUnavailableError extends Error {
  constructor() {
    super('傳輸的建立者已被停用或刪除');
  }
}

/**
 * 傳輸的執行脈絡：操作者、語系、時區與權限（docs/architecture/backend/22-data-transfer.md §6.2 `TransferContext`）。
 * 工作以建立者的身分執行（§13 D20）：以 `created_by` 重建 `AuthUser`，放進 request context，業務稽核的 actor 才是建立者。
 */
@Injectable()
export class DataTransferContextFactory {
  constructor(
    private readonly repo: DataTransferRepository,
    private readonly permissions: PermissionService,
    private readonly settings: SettingService,
  ) {}

  /** 請求內：語系與時區優先取請求帶的偏好，否則用帳號的設定。 */
  async forRequest(actor: AuthUser, preference: ClientPreference): Promise<TransferContext> {
    const owner = await this.repo.findOwner(actor.id);
    const locale =
      toTransferLocale(preference.locale) ?? toTransferLocale(owner?.locale) ?? 'zh-TW';
    const timezone =
      preference.timezone && isTimeZone(preference.timezone)
        ? preference.timezone
        : await this.timezoneOf(owner?.timezone);
    return this.build(actor, locale, timezone, NEVER);
  }

  /** 工作內：語系與時區取建立傳輸時記下的值；建立者不再 active 時拋 `TransferOwnerUnavailableError`。 */
  async forJob(transfer: DataTransferRow, signal: AbortSignal): Promise<TransferContext> {
    const owner = await this.repo.findOwner(transfer.createdBy);
    if (!owner || owner.deletedAt || owner.status !== 'active') {
      throw new TransferOwnerUnavailableError();
    }
    const actor: AuthUser = { id: owner.id, email: owner.email, status: 'active' };
    return this.build(
      actor,
      toTransferLocale(transfer.locale) ?? 'zh-TW',
      transfer.timezone,
      signal,
    );
  }

  /** 以建立者的身分執行：稽核的 actor、權限檢查都以他為準（工作沒有 HTTP 的 request context）。 */
  runAs<T>(ctx: TransferContext, jobId: string, fn: () => Promise<T>): Promise<T> {
    return runWithRequestContext(
      { requestId: `job:${jobId}`, user: { id: ctx.actor.id, email: ctx.actor.email } },
      fn,
    );
  }

  /** 重新讀取權限（套用途中每 100 列一次，§7.6「權限中途被拿掉」）。 */
  async refresh(ctx: TransferContext): Promise<TransferContext> {
    return this.build(ctx.actor, ctx.locale, ctx.timezone, ctx.signal);
  }

  async assertHasAll(
    actor: Pick<AuthUser, 'id' | 'email'>,
    keys: readonly PermissionKey[],
    route: string,
  ): Promise<void> {
    await this.permissions.assertHasAll(actor, keys, { route });
  }

  private async timezoneOf(userTimezone: string | null | undefined): Promise<string> {
    if (userTimezone && isTimeZone(userTimezone)) return userTimezone;
    return this.settings.get(DEFAULT_TIMEZONE_SETTING);
  }

  private async build(
    actor: AuthUser,
    locale: TransferLocale,
    timezone: string,
    signal: AbortSignal,
  ): Promise<TransferContext> {
    const set = await this.permissions.getPermissionSet(actor.id);
    return {
      actor,
      locale,
      timezone,
      signal,
      can: (key) => set.isSuperAdmin || set.permissions.has(key),
    };
  }
}

/** 權限不足：與 `PermissionService.assertHasAll` 拋的錯誤同一個代碼（§9.1）。 */
export function forbidden(missing: readonly PermissionKey[]): AppException {
  return new AppException('AUTHZ_FORBIDDEN', { required: missing, missing });
}
