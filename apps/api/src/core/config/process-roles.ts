/**
 * 程序的角色（docs/features/multi-instance.md §初步構想 1、D1）：同一個映像，以 `APP_ROLES` 決定這個程序打開哪些入口。
 * 純函式、不依賴任何模組：`instrumentation.ts` 與 `app.module.ts` 在 Nest 啟動之前就要用。
 */
export const PROCESS_ROLES = ['http', 'realtime', 'worker'] as const;
export type ProcessRole = (typeof PROCESS_ROLES)[number];

/** `APP_ROLES=all` 的意思：單體，三個角色都在這個程序。 */
export const ALL_PROCESS_ROLES = 'all';

/** 逗號分隔的角色清單 → 集合；`all` 是全部。格式不對回 `undefined`（環境變數驗證以它判斷）。 */
export function parseProcessRoles(value: string): ReadonlySet<ProcessRole> | undefined {
  const items = value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
  if (items.length === 1 && items[0] === ALL_PROCESS_ROLES) return new Set(PROCESS_ROLES);
  if (items.length === 0) return undefined;
  const roles = new Set<ProcessRole>();
  for (const item of items) {
    if (!(PROCESS_ROLES as readonly string[]).includes(item)) return undefined;
    roles.add(item as ProcessRole);
  }
  return roles;
}

/** 這個程序的角色；`APP_ROLES` 沒設定時是單體（全部）。驗證過的值才會到這裡，格式不對時退回全部。 */
export function processRolesOf(env: { APP_ROLES?: string }): ReadonlySet<ProcessRole> {
  return parseProcessRoles(env.APP_ROLES ?? ALL_PROCESS_ROLES) ?? new Set(PROCESS_ROLES);
}

/**
 * 服務名稱（trace 的 `service.name`、日誌）：單體是 `api`，拆開時帶角色（`api-http`、`api-http-realtime`）。
 * 依 `PROCESS_ROLES` 的順序，同一組角色永遠是同一個名稱。
 */
export function serviceNameOf(roles: ReadonlySet<ProcessRole>): string {
  if (roles.size === PROCESS_ROLES.length) return 'api';
  return ['api', ...PROCESS_ROLES.filter((role) => roles.has(role))].join('-');
}
