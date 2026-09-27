/**
 * 一行一筆 JSON 的結構化日誌（與 apps/api 的 Pino 輸出同形狀，方便一起看）。
 * 服務很小，不值得為它引入 Pino；也不用 console，避免被 `no-console` 擋下。
 */

type Level = 'info' | 'warn' | 'error';

const LEVEL_NUMBER = { info: 30, warn: 40, error: 50 } as const satisfies Record<Level, number>;

function write(level: Level, message: string, fields: Record<string, unknown>): void {
  const line = JSON.stringify({
    level: LEVEL_NUMBER[level],
    time: Date.now(),
    name: 'file-storage',
    msg: message,
    ...fields,
  });
  (level === 'info' ? process.stdout : process.stderr).write(`${line}\n`);
}

export const log = {
  info: (message: string, fields: Record<string, unknown> = {}): void =>
    write('info', message, fields),
  warn: (message: string, fields: Record<string, unknown> = {}): void =>
    write('warn', message, fields),
  error: (message: string, fields: Record<string, unknown> = {}): void =>
    write('error', message, fields),
};
