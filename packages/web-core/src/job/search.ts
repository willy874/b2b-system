import { z } from 'zod/mini';

import { JOB_STATES, JOB_VIEWS } from './constants';

/** 網址上單一或重複的參數（`?state=a&state=b`，`router/search.ts`）一律成為陣列。 */
const toArray = <T>(value: T | T[]): T[] => (Array.isArray(value) ? value : [value]);

/**
 * 背景工作列表的網址查詢條件：兩個 app 共用的欄位，各自以 `z.object({ ...jobSearchShape, … })` 組成 route 的 search
 * （apps/platform 多一個租戶欄）。route 的 search 在首頁的初始載入裡，用 zod/mini（docs/architecture/frontend/04-routing.md §3）。
 */
export const jobSearchShape = {
  /** 分頁：工作列表或佇列概況。 */
  view: z.catch(z.enum(JOB_VIEWS), 'list'),
  offset: z.catch(z.coerce.number().check(z.int(), z.minimum(0)), 0),
  limit: z.catch(z.coerce.number().check(z.int(), z.minimum(1), z.maximum(100)), 50),
  /** 其中任一種工作。 */
  name: z.catch(
    z.optional(
      z.pipe(
        z.union([
          z.string().check(z.trim(), z.minLength(1)),
          z.array(z.string().check(z.trim(), z.minLength(1))).check(z.minLength(1)),
        ]),
        z.transform(toArray),
      ),
    ),
    undefined,
  ),
  /** 其中任一種狀態。 */
  state: z.catch(
    z.optional(
      z.pipe(
        z.union([z.enum(JOB_STATES), z.array(z.enum(JOB_STATES)).check(z.minLength(1))]),
        z.transform(toArray),
      ),
    ),
    undefined,
  ),
};

/** 預設的查詢條件；與它相等的參數不寫進網址（`stripSearchParams`）。 */
export const DEFAULT_JOB_SEARCH = { view: 'list', offset: 0, limit: 50 } as const;
