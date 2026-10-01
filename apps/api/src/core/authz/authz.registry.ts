import { Injectable } from '@nestjs/common';

import { createModel } from './authz.model';
import type { AuthzModel, TypeDefinition } from './authz.model';
import { buildTenantType, GROUP_TYPE, ROLE_TYPE, USER_TYPE } from './authz.types';

/**
 * 模型的註冊表：核心型別（user、group、role、tenant）在這裡，業務型別由各模組在 `onModuleInit` 註冊
 * （core 不認識業務，docs/conventions/07-layer-dependencies.md §3.2）。
 * 第一次取用 `model` 時組合並驗證；之後再註冊會讓下一次取用重新組合。
 */
@Injectable()
export class AuthzRegistry {
  private readonly extra = new Map<string, TypeDefinition>();
  /** 以 `withDependencies` 分開快取：G2 的影子比對會交替用到兩種。 */
  private readonly cached = new Map<boolean, AuthzModel>();

  register(definition: TypeDefinition): void {
    this.extra.set(definition.name, definition);
    this.cached.clear();
  }

  /**
   * 目前的模型。`withDependencies` 見 `buildTenantType`；G1 影子比對用 false，G2 起的正式解析用 true。
   */
  model(withDependencies: boolean): AuthzModel {
    const cached = this.cached.get(withDependencies);
    if (cached) return cached;
    const model = createModel([
      USER_TYPE,
      GROUP_TYPE,
      ROLE_TYPE,
      buildTenantType({ withDependencies }),
      ...this.extra.values(),
    ]);
    this.cached.set(withDependencies, model);
    return model;
  }
}
