import { Injectable } from '@nestjs/common';

import { AppException } from '@/core/errors';
import { requireTenant } from '@/core/tenant';

import type { CommentResourceDefinition } from './comment.types';

/**
 * 可以留言與關注的資源類型（docs/architecture/backend/24-comment.md §8.2 D2）：擁有者在 `onModuleInit` 登記，
 * `CommentService` 與 `WatchService` 共用。`modules/comment` 不 import 任何業務模組。
 */
@Injectable()
export class CommentResourceRegistry {
  private readonly resources = new Map<string, CommentResourceDefinition>();

  register(definition: CommentResourceDefinition): void {
    if (this.resources.has(definition.resourceType)) {
      throw new Error(`可留言的資源 ${definition.resourceType} 重複登記`);
    }
    this.resources.set(definition.resourceType, definition);
  }

  /** 端點用：要有登記，所屬 feature 要啟用（`404 FEATURE_DISABLED`）。 */
  require(resourceType: string): CommentResourceDefinition {
    const definition = this.resources.get(resourceType);
    if (!definition) throw new AppException('COMMENT_RESOURCE_TYPE_UNKNOWN', { resourceType });
    if (definition.feature && !requireTenant().features.includes(definition.feature)) {
      throw new AppException('FEATURE_DISABLED', { feature: definition.feature });
    }
    return definition;
  }

  /** 背景工作用：沒有登記（擁有者已下線）或 feature 沒啟用時回 `undefined`，由呼叫端略過。 */
  find(resourceType: string): CommentResourceDefinition | undefined {
    const definition = this.resources.get(resourceType);
    if (!definition) return undefined;
    if (definition.feature && !requireTenant().features.includes(definition.feature)) {
      return undefined;
    }
    return definition;
  }
}
