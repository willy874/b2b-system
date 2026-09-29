const UNITS = ['B', 'KB', 'MB', 'GB', 'TB'] as const;

/**
 * 位元組 → 人看得懂的大小（1024 進位，`1.5 MB`）。單位是通用符號，不走 i18n。
 * `fractionDigits` 只套用在 KB 以上；位元組一律整數。
 */
export function formatBytes(bytes: number, fractionDigits = 1): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '—';
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < UNITS.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return unit === 0 ? `${value} B` : `${value.toFixed(fractionDigits)} ${UNITS[unit]}`;
}
