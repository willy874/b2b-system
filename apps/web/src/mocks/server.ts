import { setupServer } from 'msw/node';

import { handlers } from './handlers';

/** 測試用；個別 case 用 `server.use(...)` 覆寫。 */
export const server = setupServer(...handlers);
