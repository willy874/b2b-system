import { ApmError } from '@/http/errors';

import { parseEnvelope, parseItemJson } from '../parse';

function envelope(...lines: string[]): Buffer {
  return Buffer.from(lines.join('\n'), 'utf8');
}

describe('parseEnvelope（Sentry envelope 格式）', () => {
  it('解析 header 與沒有 length 的項目（讀到換行為止）', () => {
    const parsed = parseEnvelope(
      envelope('{"event_id":"abc"}', '{"type":"event"}', '{"message":"hi"}', ''),
    );
    expect(parsed.header.event_id).toBe('abc');
    expect(parsed.items).toHaveLength(1);
    expect(parsed.items[0]?.header.type).toBe('event');
    expect(parseItemJson(parsed.items[0]!)).toEqual({ message: 'hi' });
  });

  it('有 length 時照長度讀，payload 可以含換行', () => {
    const payload = 'line1\nline2';
    const parsed = parseEnvelope(
      envelope(
        '{}',
        `{"type":"attachment","length":${Buffer.byteLength(payload)}}`,
        payload,
        '{"type":"client_report"}',
        '{"discarded_events":[]}',
      ),
    );
    expect(parsed.items.map((item) => item.header.type)).toEqual(['attachment', 'client_report']);
    expect(parsed.items[0]?.payload.toString()).toBe(payload);
  });

  it('length 以位元組計算（多位元組字元）', () => {
    const payload = '{"message":"中文"}';
    const parsed = parseEnvelope(
      envelope('{}', `{"type":"event","length":${Buffer.byteLength(payload)}}`, payload),
    );
    expect(parseItemJson(parsed.items[0]!)).toEqual({ message: '中文' });
  });

  it.each([
    ['空的內容', ''],
    ['header 不是 JSON', 'not json'],
    ['header 不是物件', '[1]'],
    ['item 沒有 type', '{}\n{"length":1}\nx'],
    ['length 超出內容', '{}\n{"type":"event","length":100}\n{}'],
    ['length 是負數', '{}\n{"type":"event","length":-1}\n{}'],
  ])('%s → 400', (_name, body) => {
    expect(() => parseEnvelope(Buffer.from(body))).toThrow(ApmError);
  });

  it('payload 不是 JSON 物件時 parseItemJson 回 undefined（略過該項目）', () => {
    const parsed = parseEnvelope(envelope('{}', '{"type":"event"}', 'oops'));
    expect(parseItemJson(parsed.items[0]!)).toBeUndefined();
  });
});
