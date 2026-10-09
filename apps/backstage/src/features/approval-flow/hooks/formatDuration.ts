/**
 * 平均時間的顯示：不到 1 小時以分鐘、不到 2 天以小時、其餘以天（四捨五入到一位小數）。
 * `t` 帶 `count` 讓各語系處理單複數。
 */
export function formatDuration(
  hours: number,
  t: (key: string, options?: Record<string, unknown>) => string,
): string {
  if (hours < 1)
    return t('approvalFlow.duration.minutes', { count: Math.max(1, Math.round(hours * 60)) });
  if (hours < 48) return t('approvalFlow.duration.hours', { count: Math.round(hours * 10) / 10 });
  return t('approvalFlow.duration.days', { count: Math.round((hours / 24) * 10) / 10 });
}
