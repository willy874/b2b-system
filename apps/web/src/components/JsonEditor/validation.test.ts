import { describe, expect, it } from 'vitest';

import { formatDisplayPath } from './displayPath';
import { createJsonSchemaValidator } from './validation';

const schema = {
  type: 'object',
  required: ['id'],
  properties: {
    id: { type: 'number' },
    hp: { type: 'integer', minimum: 0 },
    tags: { type: 'array', items: { type: 'string' } },
    'a/b': { type: 'string' },
  },
  additionalProperties: false,
};

describe('createJsonSchemaValidator（ajv）', () => {
  it('路徑轉成節點路徑：陣列索引是數字、JSON Pointer 的跳脫還原', async () => {
    const errors = await createJsonSchemaValidator(schema)({ id: 1, tags: ['a', 2], 'a/b': 3 });
    expect(errors.map((error) => [error.path, error.keyword])).toEqual([
      [['tags', 1], 'type'],
      [['a/b'], 'type'],
    ]);
  });

  it('required 標在物件上；多出來的鍵標在那個鍵上；已宣告的屬性驗證失敗不會被誤報成多餘', async () => {
    const errors = await createJsonSchemaValidator(schema)({ hp: -1, extra: true });
    expect(errors.map((error) => [error.path, error.keyword])).toEqual([
      [[], 'required'],
      [['extra'], 'additionalProperties'],
      [['hp'], 'minimum'],
    ]);
  });

  it('依 $schema 選 draft；支援 format（ajv-formats）', async () => {
    const validate = createJsonSchemaValidator({
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      type: 'string',
      format: 'date-time',
    });
    expect(await validate('2026-09-25T10:00:00Z')).toEqual([]);
    expect((await validate('yesterday'))[0]).toMatchObject({ keyword: 'format', path: [] });
  });

  it('formatMessage 改寫訊息', async () => {
    const validate = createJsonSchemaValidator(schema, {
      formatMessage: (error) => `【${error.keyword}】`,
    });
    expect((await validate({}))[0]?.message).toBe('【required】');
  });

  it('schema 不合法時 reject', async () => {
    await expect(createJsonSchemaValidator({ type: 'nope' })({})).rejects.toThrow();
  });
});

describe('formatDisplayPath', () => {
  it.each([
    [[], '（根）'],
    [['stats', 'hp'], 'stats.hp'],
    [['skills', 0, 'name'], 'skills[0].name'],
    [['a b', 'c'], '["a b"].c'],
  ])('%j → %s', (path, expected) => {
    expect(formatDisplayPath(path, '（根）')).toBe(expected);
  });
});
