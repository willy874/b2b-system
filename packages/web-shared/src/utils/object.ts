/** 移除 undefined 的鍵，用於組 query 參數。 */
export function compact<T extends Record<string, unknown>>(input: T): Partial<T> {
  const out: Partial<T> = {};
  for (const [key, value] of Object.entries(input)) {
    if (value !== undefined && value !== '') out[key as keyof T] = value as T[keyof T];
  }
  return out;
}

export function unique<T>(values: readonly T[]): T[] {
  return [...new Set(values)];
}
