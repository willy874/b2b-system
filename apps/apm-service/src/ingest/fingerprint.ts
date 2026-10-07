import { createHash } from 'node:crypto';

/** SDK 指定 fingerprint 時可以用這個佔位代表「預設分組」（Sentry 的慣例）。 */
const DEFAULT_PLACEHOLDER = '{{ default }}';

/**
 * 訊息裡會隨每次發生而變的部分換成佔位，同一個錯誤才會落在同一組。
 * 壓縮後的函式名稱每版不同，所以不拿堆疊分組（docs/architecture/frontend/19-observability.md §9.2 D8）。
 */
export function normalizeMessage(message: string): string {
  return message
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '<uuid>')
    .replace(/(["'`])(?:(?!\1).){0,200}\1/g, '<str>')
    .replace(/\b0x[0-9a-f]+\b|\b[0-9a-f]{8,}\b/gi, '<hex>')
    .replace(/\d+(?:\.\d+)?/g, '<n>');
}

export interface FingerprintInput {
  project: string;
  /** SDK 送來的 `fingerprint`。 */
  custom: unknown;
  type: string | undefined;
  value: string | undefined;
}

/** 回傳 16 碼 hex 的 group id；不同專案的同一個錯誤分開。 */
export function computeGroupId({ project, custom, type, value }: FingerprintInput): string {
  const defaultParts = [type ?? 'Error', normalizeMessage(value ?? '')];
  let parts = defaultParts;
  if (
    Array.isArray(custom) &&
    custom.length > 0 &&
    custom.every((part) => typeof part === 'string')
  ) {
    parts = (custom as string[]).flatMap((part) =>
      part === DEFAULT_PLACEHOLDER ? defaultParts : [part],
    );
  }
  return createHash('sha1')
    .update([project, ...parts].join('\n'))
    .digest('hex')
    .slice(0, 16);
}
