import { ComponentLabelsContext } from '@b2b-system/ui/labels';
import type { ComponentLabels } from '@b2b-system/ui/labels';
import { useMemo } from 'react';
import type { ReactNode } from 'react';

import { useTranslation } from '../locales';

/**
 * 設計系統元件的預設文案改用目前語系：`components/` 不依賴語系，由這裡以 `t()` 傳入
 * 切換語系時 `t` 換新，文案跟著更新。
 */
export function ComponentLabelsHost({ children }: { children: ReactNode }) {
  const { t, language } = useTranslation();
  const labels = useMemo<ComponentLabels>(
    () => ({
      required: t('components.required'),
      selectSearch: t('components.selectSearch'),
      selectNoMatch: t('components.selectNoMatch'),
      selectLoading: t('common.loading'),
      selectAll: t('components.selectAll'),
      toastClose: t('common.close'),
      paginationNav: t('components.pagination.nav'),
      paginationPageSize: t('components.pagination.pageSize'),
      paginationFirst: t('components.pagination.first'),
      paginationLast: t('components.pagination.last'),
      paginationPrevious: t('common.previous'),
      paginationNext: t('common.next'),
      paginationPage: t('components.pagination.page'),
      locale: language,
      loading: t('common.loading'),
      calendarPreviousMonth: t('components.calendar.previousMonth'),
      calendarNextMonth: t('components.calendar.nextMonth'),
      datePickerClear: t('common.clear'),
      datePickerOpen: t('components.datePicker.open'),
      treeEditor: {
        addRoot: t('components.treeEditor.addRoot'),
        addChild: t('components.treeEditor.addChild'),
        deleteSelection: t('components.treeEditor.deleteSelection'),
        autoLayout: t('components.treeEditor.autoLayout'),
        fitView: t('components.treeEditor.fitView'),
        zoomIn: t('components.treeEditor.zoomIn'),
        zoomOut: t('components.treeEditor.zoomOut'),
        undo: t('components.treeEditor.undo'),
        redo: t('components.treeEditor.redo'),
        more: t('common.more'),
        empty: t('components.treeEditor.empty'),
      },
      richTextEditor: {
        bold: t('components.richTextEditor.bold'),
        italic: t('components.richTextEditor.italic'),
        underline: t('components.richTextEditor.underline'),
        strike: t('components.richTextEditor.strike'),
        code: t('components.richTextEditor.code'),
        heading2: t('components.richTextEditor.heading2'),
        heading3: t('components.richTextEditor.heading3'),
        bulletList: t('components.richTextEditor.bulletList'),
        orderedList: t('components.richTextEditor.orderedList'),
        blockquote: t('components.richTextEditor.blockquote'),
        codeBlock: t('components.richTextEditor.codeBlock'),
        horizontalRule: t('components.richTextEditor.horizontalRule'),
        link: t('components.richTextEditor.link'),
        undo: t('components.richTextEditor.undo'),
        redo: t('components.richTextEditor.redo'),
        more: t('common.more'),
        linkUrl: t('components.richTextEditor.linkUrl'),
        linkApply: t('common.apply'),
        linkRemove: t('components.richTextEditor.linkRemove'),
        linkCancel: t('common.cancel'),
        linkInvalid: t('components.richTextEditor.linkInvalid'),
        // 參數不叫 count：i18next 會把 count 當成複數判斷去找 _other
        characterCount: (count, max) =>
          t('components.richTextEditor.characterCount', { current: count, max }),
      },
    }),
    [t, language],
  );
  return <ComponentLabelsContext value={labels}>{children}</ComponentLabelsContext>;
}
