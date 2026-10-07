import { ApmError } from '@/http/errors';

/**
 * Sentry 的 envelope（https://develop.sentry.dev/sdk/data-model/envelopes/）：
 *
 * ```
 * {"event_id":"…","dsn":"…","sent_at":"…"}\n      ← envelope header
 * {"type":"event","length":123}\n                 ← item header（length 可省略）
 * {…payload…}\n                                   ← item payload
 * …
 * ```
 *
 * 有 `length` 時照長度讀（payload 可以含換行，例如附件）；沒有時讀到下一個換行。
 */
export interface EnvelopeHeader {
  event_id?: string;
  dsn?: string;
  sent_at?: string;
  [key: string]: unknown;
}

export interface EnvelopeItemHeader {
  type: string;
  length?: number;
  [key: string]: unknown;
}

export interface EnvelopeItem {
  header: EnvelopeItemHeader;
  payload: Buffer;
}

export interface Envelope {
  header: EnvelopeHeader;
  items: EnvelopeItem[];
}

const NEWLINE = 0x0a;
/** 一個 envelope 最多幾個 item；SDK 一次只送一個事件加少數附屬項目。 */
const MAX_ITEMS = 100;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseJsonLine(buffer: Buffer, what: string): Record<string, unknown> {
  let value: unknown;
  try {
    value = JSON.parse(buffer.toString('utf8'));
  } catch {
    throw new ApmError(400, `envelope 的 ${what} 不是合法的 JSON`);
  }
  if (!isRecord(value)) throw new ApmError(400, `envelope 的 ${what} 必須是 JSON 物件`);
  return value;
}

/** 從 `offset` 讀到下一個換行（不含換行）；回傳內容與下一行的開頭。 */
function readLine(data: Buffer, offset: number): { line: Buffer; next: number } {
  const end = data.indexOf(NEWLINE, offset);
  return end === -1
    ? { line: data.subarray(offset), next: data.length }
    : { line: data.subarray(offset, end), next: end + 1 };
}

export function parseEnvelope(data: Buffer): Envelope {
  const first = readLine(data, 0);
  if (first.line.length === 0) throw new ApmError(400, 'envelope 是空的');
  const header = parseJsonLine(first.line, 'header') as EnvelopeHeader;

  const items: EnvelopeItem[] = [];
  let offset = first.next;
  while (offset < data.length) {
    const headerLine = readLine(data, offset);
    offset = headerLine.next;
    // 結尾多一個換行是合法的
    if (headerLine.line.length === 0) continue;
    if (items.length >= MAX_ITEMS) throw new ApmError(400, `envelope 的項目超過 ${MAX_ITEMS} 個`);

    const itemHeader = parseJsonLine(headerLine.line, 'item header');
    if (typeof itemHeader.type !== 'string' || itemHeader.type === '') {
      throw new ApmError(400, 'envelope 的 item header 缺少 type');
    }
    const length = itemHeader.length;
    let payload: Buffer;
    if (length === undefined) {
      const payloadLine = readLine(data, offset);
      payload = payloadLine.line;
      offset = payloadLine.next;
    } else {
      if (typeof length !== 'number' || !Number.isInteger(length) || length < 0) {
        throw new ApmError(400, 'envelope 的 item length 必須是非負整數');
      }
      if (offset + length > data.length) throw new ApmError(400, 'envelope 的 item 長度超出內容');
      payload = data.subarray(offset, offset + length);
      offset += length;
      if (data[offset] === NEWLINE) offset += 1;
    }
    items.push({ header: itemHeader as EnvelopeItemHeader, payload });
  }
  return { header, items };
}

/** item 的 payload 以 JSON 解析；不是物件時回 `undefined`（該項目略過，不讓整個 envelope 失敗）。 */
export function parseItemJson(item: EnvelopeItem): Record<string, unknown> | undefined {
  try {
    const value: unknown = JSON.parse(item.payload.toString('utf8'));
    return isRecord(value) ? value : undefined;
  } catch {
    return undefined;
  }
}
