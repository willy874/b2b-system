import type { Adapter, AdapterPayload } from 'oidc-provider';

import type { OidcPayloadRepository } from './oidc-payload.repository';

/**
 * `oidc-provider` 的儲存介面接到 Postgres（`oidc_payloads`）。一個模型一個實例（`name` 是模型名稱）。
 * 過期的列視為不存在（清理排程另外刪）；用過的授權碼回傳 `consumed`，由 provider 判斷重放。
 */
export class DrizzleOidcAdapter implements Adapter {
  constructor(
    private readonly name: string,
    private readonly repo: OidcPayloadRepository,
  ) {}

  async upsert(id: string, payload: AdapterPayload, expiresIn: number): Promise<void> {
    await this.repo.upsert({
      type: this.name,
      id,
      payload: payload as Record<string, unknown>,
      grantId: payload.grantId ?? null,
      uid: payload.uid ?? null,
      userCode: payload.userCode ?? null,
      expiresAt: expiresIn ? new Date(Date.now() + expiresIn * 1000) : null,
    });
  }

  async find(id: string): Promise<AdapterPayload | undefined> {
    return this.toPayload(await this.repo.find(this.name, id));
  }

  async findByUid(uid: string): Promise<AdapterPayload | undefined> {
    return this.toPayload(await this.repo.findBy(this.name, 'uid', uid));
  }

  async findByUserCode(userCode: string): Promise<AdapterPayload | undefined> {
    return this.toPayload(await this.repo.findBy(this.name, 'userCode', userCode));
  }

  async consume(id: string): Promise<void> {
    await this.repo.consume(this.name, id);
  }

  async destroy(id: string): Promise<void> {
    await this.repo.destroy(this.name, id);
  }

  async revokeByGrantId(grantId: string): Promise<void> {
    await this.repo.destroyByGrantId(grantId);
  }

  private toPayload(
    row: Awaited<ReturnType<OidcPayloadRepository['find']>>,
  ): AdapterPayload | undefined {
    if (!row) return undefined;
    if (row.expiresAt && row.expiresAt.getTime() <= Date.now()) return undefined;
    const payload = row.payload as AdapterPayload;
    return row.consumedAt
      ? { ...payload, consumed: Math.floor(row.consumedAt.getTime() / 1000) }
      : payload;
  }
}
