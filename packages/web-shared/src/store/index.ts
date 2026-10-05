/** 框架無關的入口；React 綁定（`create`、`useStore`、`useComputed`…）從 `@b2b-system/web-shared/hooks` 匯入。 */
export { computed, untracked } from '@sigrea/core';

export * from './createStore';
export * from './shareStore';
export * from './syncStore';
export * from './watch';
