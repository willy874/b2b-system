import { useComponentLabels } from '../labels';

export interface DatePickerLabels {
  /** 清除鈕的名稱。 */
  clear?: string;
  /** 觸發鈕的名稱（沒有 `aria-label`、也不在 `Field` 裡時）。 */
  open?: string;
  /** 日曆切換月份的按鈕。 */
  previousMonth?: string;
  nextMonth?: string;
}

/** 把呼叫端傳的文案補上 `ComponentLabelsContext` 的值（`DatePicker`、`DateRangePicker` 共用，不對外匯出）。 */
export function useDatePickerLabels(
  labels: DatePickerLabels | undefined,
): Required<DatePickerLabels> {
  const componentLabels = useComponentLabels();
  return {
    clear: labels?.clear ?? componentLabels.datePickerClear,
    open: labels?.open ?? componentLabels.datePickerOpen,
    previousMonth: labels?.previousMonth ?? componentLabels.calendarPreviousMonth,
    nextMonth: labels?.nextMonth ?? componentLabels.calendarNextMonth,
  };
}
