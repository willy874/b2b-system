import { describe, expect, it } from 'vitest';

import { RESOURCE_TYPE } from '../resource-types';

describe('RESOURCE_TYPE（docs/architecture/backend/14-revisions.md §9.2 D7）', () => {
  const values = Object.values(RESOURCE_TYPE);

  it('每個資源類型的字串都不重複（回收桶、版本歷史、稽核共用同一組值）', () => {
    expect(new Set(values).size).toBe(values.length);
  });

  it.each(values)('%s 是 camelCase（與 audit_logs.resource_type 一致）', (value) => {
    expect(value).toMatch(/^[a-z][a-zA-Z]*$/);
  });

  it('已發布的值不改名', () => {
    expect(RESOURCE_TYPE).toMatchObject({
      USER: 'user',
      ROLE: 'role',
      GROUP: 'group',
      FILE: 'file',
      FILE_FOLDER: 'fileFolder',
      SERVICE_ACCOUNT: 'serviceAccount',
      API_TOKEN: 'apiToken',
      WEBHOOK: 'webhook',
      TAG: 'tag',
      ANNOUNCEMENT: 'announcement',
    });
  });
});
