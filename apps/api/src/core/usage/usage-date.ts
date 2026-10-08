/** 用量的日期一律是 UTC 的日曆日 `YYYY-MM-DD`（docs/architecture/05-tenancy.md §14.2 D4）。 */
export function usageDate(at: Date = new Date()): string {
  return at.toISOString().slice(0, 10);
}

/** `date` 往前 `days` 天的 UTC 日期。 */
export function usageDateDaysBefore(date: string, days: number): string {
  const at = new Date(`${date}T00:00:00.000Z`);
  at.setUTCDate(at.getUTCDate() - days);
  return usageDate(at);
}
