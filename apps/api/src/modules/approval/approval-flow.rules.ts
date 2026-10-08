import type { ApprovalCondition, ApprovalFlowStep } from '@/db/schema';

import type { ApprovalFlowSupport } from './approval.types';

/**
 * 多階段流程的純函式（docs/architecture/backend/20-approval.md §9.5、D2）：條件判斷與流程內容的驗證。
 * 不碰資料庫，送出、試算、流程編輯共用。
 */

function compare(op: ApprovalCondition['op'], actual: number | string, expected: unknown): boolean {
  if (op === 'in') {
    return Array.isArray(expected) && expected.some((value) => value === actual);
  }
  if (typeof expected !== typeof actual) return false;
  switch (op) {
    case 'eq':
      return actual === expected;
    case 'ne':
      return actual !== expected;
    case 'gt':
      return actual > (expected as typeof actual);
    case 'gte':
      return actual >= (expected as typeof actual);
    case 'lt':
      return actual < (expected as typeof actual);
    case 'lte':
      return actual <= (expected as typeof actual);
  }
}

/**
 * 這一關的條件是否全部成立（AND；沒有條件 = 成立）。
 * 欄位不在 handler 的宣告裡、或從 payload 取不到值 → 該條件不成立（關卡略過，D2）。
 */
export function conditionsMet(
  conditions: readonly ApprovalCondition[],
  support: ApprovalFlowSupport,
  payload: Record<string, unknown>,
): boolean {
  return conditions.every((condition) => {
    const field = support.fields.find((candidate) => candidate.key === condition.field);
    if (!field) return false;
    const actual = field.read(payload);
    if (actual === null) return false;
    return compare(condition.op, actual, condition.value);
  });
}

/** 依測試用的欄位值（試算）判斷：沒有 payload，直接拿欄位值比對。 */
export function conditionsMetByValues(
  conditions: readonly ApprovalCondition[],
  values: Record<string, number | string | null | undefined>,
): boolean {
  return conditions.every((condition) => {
    const actual = values[condition.field];
    if (actual === null || actual === undefined) return false;
    return compare(condition.op, actual, condition.value);
  });
}

/**
 * 流程內容與 handler 宣告的一致性（zod 只驗形狀）：回傳 `VALIDATION_FAILED` 的 `fields`（路徑 → 原因），沒有問題回空物件。
 *
 * - 關卡的 key 不重複。
 * - 條件的欄位要在宣告裡；運算子要適合欄位的型別（字串與列舉只能 `eq`／`ne`／`in`）；值的型別要對；列舉的值要在選項裡。
 * - 匿名申請的類型不能用 `manager`（沒有申請人可以往上找）。
 */
export function validateFlowSteps(
  steps: readonly ApprovalFlowStep[],
  support: ApprovalFlowSupport,
): Record<string, string> {
  const errors: Record<string, string> = {};
  const keys = new Set<string>();
  steps.forEach((step, index) => {
    if (keys.has(step.key)) errors[`steps.${index}.key`] = 'duplicate step key';
    keys.add(step.key);
    if (step.assignee.kind === 'manager' && support.requester === 'anonymous') {
      errors[`steps.${index}.assignee.kind`] = 'manager is not available for anonymous requests';
    }
    step.conditions.forEach((condition, conditionIndex) => {
      const path = `steps.${index}.conditions.${conditionIndex}`;
      const field = support.fields.find((candidate) => candidate.key === condition.field);
      if (!field) {
        errors[`${path}.field`] = 'unknown field';
        return;
      }
      const ordered = ['gt', 'gte', 'lt', 'lte'].includes(condition.op);
      if (ordered && field.type !== 'number') {
        errors[`${path}.op`] = 'operator requires a number field';
        return;
      }
      const values = condition.op === 'in' ? condition.value : [condition.value];
      if (!Array.isArray(values) || (condition.op !== 'in' && Array.isArray(condition.value))) {
        errors[`${path}.value`] =
          condition.op === 'in' ? 'expected a list' : 'expected a single value';
        return;
      }
      const expectedType = field.type === 'number' ? 'number' : 'string';
      if (values.some((value) => typeof value !== expectedType)) {
        errors[`${path}.value`] = `expected ${expectedType}`;
        return;
      }
      if (
        field.type === 'enum' &&
        values.some((value) => !field.options?.includes(String(value)))
      ) {
        errors[`${path}.value`] = 'not one of the options';
      }
    });
  });
  return errors;
}
