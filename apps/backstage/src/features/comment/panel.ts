import { lazy } from 'react';

import { registerResourcePanel } from '@/core/resource-panel';

import { COMMENTABLE_RESOURCE_TYPES } from './constants';
import { COMMENT_LOCALE_SCOPE } from './locale';

// 只有資源頁會渲染：登記 lazy 元件，本體（編輯器、提及的選擇器）不進首屏
const CommentPanel = lazy(() =>
  import('./components/CommentPanel').then((module) => ({ default: module.CommentPanel })),
);

/** 在 plugin 的同步階段呼叫：可以留言的資源頁多一個「留言」面板（docs/architecture/frontend/22-comment.md §2）。 */
export function registerCommentPanel(): void {
  registerResourcePanel({
    id: 'comment',
    order: 100,
    resourceTypes: COMMENTABLE_RESOURCE_TYPES,
    Panel: CommentPanel,
    localeScope: COMMENT_LOCALE_SCOPE,
  });
}
