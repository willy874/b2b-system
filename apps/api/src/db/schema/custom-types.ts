import { customType } from 'drizzle-orm/pg-core';

/** 大小寫不敏感的文字型別（需要 `CREATE EXTENSION citext`）。 */
export const citext = customType<{ data: string; driverData: string }>({
  dataType() {
    return 'citext';
  },
});
