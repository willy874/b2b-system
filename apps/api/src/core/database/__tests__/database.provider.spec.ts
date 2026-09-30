import { describe, expect, it } from 'vitest';

import {
  connectionLimitsOf,
  DEFAULT_CONNECTION_LIMITS,
  postgresOptionsOf,
} from '../database.provider';

describe('postgresOptionsOf（docs/architecture/backend/02-database.md §6.2）', () => {
  it('逾時以連線參數送出：statement_timeout、idle_in_transaction_session_timeout、connect_timeout', () => {
    const options = postgresOptionsOf({
      max: 10,
      idleTimeout: 30,
      limits: { connectTimeout: 5, statementTimeoutMs: 15_000, idleInTransactionTimeoutMs: 30_000 },
    });
    expect(options).toMatchObject({
      max: 10,
      idle_timeout: 30,
      connect_timeout: 5,
      connection: { statement_timeout: 15_000, idle_in_transaction_session_timeout: 30_000 },
    });
  });

  it('0 代表不限制：不送那個參數（沿用伺服器的設定）', () => {
    const options = postgresOptionsOf({
      max: 3,
      limits: { connectTimeout: 10, statementTimeoutMs: 0, idleInTransactionTimeoutMs: 0 },
    });
    expect(options.connection).toEqual({});
  });

  it('沒給 limits 時用預設值', () => {
    expect(postgresOptionsOf({ max: 3 })).toMatchObject({
      idle_timeout: 30,
      connect_timeout: DEFAULT_CONNECTION_LIMITS.connectTimeout,
      connection: { statement_timeout: DEFAULT_CONNECTION_LIMITS.statementTimeoutMs },
    });
  });
});

describe('connectionLimitsOf', () => {
  it('環境變數 → 逾時設定', () => {
    expect(
      connectionLimitsOf({
        DB_CONNECT_TIMEOUT: 7,
        DB_STATEMENT_TIMEOUT_MS: 1000,
        DB_IDLE_IN_TRANSACTION_TIMEOUT_MS: 2000,
      }),
    ).toEqual({ connectTimeout: 7, statementTimeoutMs: 1000, idleInTransactionTimeoutMs: 2000 });
  });
});
