import { createContext, use } from 'react';

/**
 * `Field` 交給「自製控制項」的關聯資訊。
 *
 * Base UI 的 `Field.Label`／`Description`／`Error` 只認得向它登記過 id 的控制項（`Input`、`NumberField`、
 * `Checkbox`、`Switch`）。`Select`、`DatePicker` 的觸發鈕是 `Popover.Trigger`，登記不到：`<label for>` 指向不存在的 id，
 * 說明與錯誤也不會出現在 `aria-describedby`。這類控制項改從這裡取得 id，自己標上 ARIA 屬性。
 */
export interface FieldControlContextValue {
  /**
   * 自製控制項的根元素要帶的 `id`：點標籤時 `Field` 以它找到並聚焦控制項。
   * 不用 `<label for>`：`for` 指向按鈕時，點標籤等於點按鈕（會打開下拉），原生 `<select>` 只會聚焦。
   */
  controlId: string;
  /** 標籤的 id；沒有 `label` 時是 `undefined`。 */
  labelId: string | undefined;
  /** 目前顯示中的說明與錯誤的 id（以空白分隔），沒有時是 `undefined`。 */
  describedBy: string | undefined;
  /** `Field` 帶著 `error`。 */
  invalid: boolean;
}

export const FieldControlContext = createContext<FieldControlContextValue | null>(null);

/** 自製控制項取得所在 `Field` 的標籤、說明與錯誤；不在 `Field` 裡時回傳 `null`。 */
export function useFieldControl(): FieldControlContextValue | null {
  return use(FieldControlContext);
}
