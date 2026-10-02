import { z } from 'zod';

import { MAX_NOTIFICATION_PARAMS_BYTES } from './notification.constants';
import { isNotificationType, isRouteId } from './notification.definition';
import type { NotificationInput } from './notification.definition';

const ParamValueSchema = z.union([
  z.string().max(500),
  z.number(),
  z.boolean(),
  z.null(),
  z.array(z.string().max(500)).max(100),
]);

/** 呼叫端的程式錯誤（不是使用者輸入）：不符就拋 `Error`，讓業務交易一起失敗、在測試裡就被發現。 */
const NotificationInputSchema = z.object({
  type: z.string().max(100).refine(isNotificationType, { message: '類型格式不對' }),
  recipientId: z.string().uuid(),
  actorId: z.string().uuid().nullable(),
  sourceId: z.string().uuid().nullable().optional(),
  params: z
    .record(z.string().max(100), ParamValueSchema)
    .refine(
      (params) =>
        Buffer.byteLength(JSON.stringify(params), 'utf8') <= MAX_NOTIFICATION_PARAMS_BYTES,
      { message: `params 超過 ${MAX_NOTIFICATION_PARAMS_BYTES} bytes：只放名稱快照` },
    ),
  link: z
    .object({
      route: z.string().max(100).refine(isRouteId, { message: 'route id 格式不對' }),
      params: z.record(z.string().max(100), z.string().max(500)),
    })
    .nullable(),
});

export interface PreparedNotifications {
  /** 要寫入的列（已排除自己、去重、截斷）。 */
  rows: NotificationInput[];
  /** 操作者就是收件人而略過的筆數（docs/architecture/backend/15-notification.md §12.2 D7）。 */
  skippedSelf: number;
  /** 超過上限被截掉的筆數（D6）。 */
  truncated: number;
}

/**
 * `notify()` 寫入前的整理（純函式）：驗證 → 略過操作者自己 → 同一類型同一位收件人只留第一筆 → 截到 `max` 筆。
 * 去重以「類型 ＋ 收件人」為鍵：同一次呼叫裡對同一個人發兩種不同的通知是合理的。
 */
export function prepareNotifications(
  inputs: readonly NotificationInput[],
  max: number,
): PreparedNotifications {
  const seen = new Set<string>();
  const rows: NotificationInput[] = [];
  let skippedSelf = 0;
  for (const input of inputs) {
    const parsed = NotificationInputSchema.safeParse(input);
    if (!parsed.success) {
      throw new Error(`通知 ${input.type} 的輸入不合格式：${parsed.error.message}`);
    }
    if (input.actorId !== null && input.actorId === input.recipientId) {
      skippedSelf += 1;
      continue;
    }
    const key = `${input.type} ${input.recipientId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push(input);
  }
  const truncated = Math.max(0, rows.length - max);
  return { rows: truncated ? rows.slice(0, max) : rows, skippedSelf, truncated };
}
