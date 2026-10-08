import { describe, expect, it } from 'vitest';

import { jsonBody, withQuery } from '../request';

describe('withQuery（物件 → query string）', () => {
  it('沒有參數或全部略過時原樣回傳', () => {
    expect(withQuery('/users')).toBe('/users');
    expect(withQuery('/users', { a: undefined, b: null, c: '' })).toBe('/users');
  });

  it('數字與布林轉字串；陣列展開成重複的 key', () => {
    expect(withQuery('/users', { page: 2, active: false, ids: ['a', 'b'] })).toBe(
      '/users?page=2&active=false&ids=a&ids=b',
    );
  });

  it('特殊字元經過編碼', () => {
    expect(withQuery('/search', { q: 'a&b c' })).toBe('/search?q=a%26b+c');
  });
});

describe('jsonBody（以 JSON 送出）', () => {
  it('序列化 body 並加上 content-type', () => {
    const init = jsonBody({ name: 'A' });
    expect(init.body).toBe('{"name":"A"}');
    expect(new Headers(init.headers).get('content-type')).toBe('application/json');
  });

  it('保留呼叫端的 headers 與其他設定（物件、陣列、Headers 皆可）', () => {
    const fromObject = jsonBody(1, { method: 'PATCH', headers: { 'if-match': '3' } });
    expect(fromObject.method).toBe('PATCH');
    expect(new Headers(fromObject.headers).get('if-match')).toBe('3');

    const fromArray = jsonBody(1, { headers: [['x-a', '1']] });
    expect(new Headers(fromArray.headers).get('x-a')).toBe('1');

    const fromHeaders = jsonBody(1, { headers: new Headers({ 'x-b': '2' }) });
    expect(new Headers(fromHeaders.headers).get('x-b')).toBe('2');
  });

  it('呼叫端的 content-type 被換成 JSON', () => {
    const init = jsonBody(1, { headers: { 'content-type': 'text/plain' } });
    expect(new Headers(init.headers).get('content-type')).toBe('application/json');
  });
});
