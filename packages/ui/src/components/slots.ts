import { cn } from '@b2b-system/web-shared/utils';
import type { ClassValue } from '@b2b-system/web-shared/utils';
import type { CSSProperties } from 'react';

/**
 * 多層元件的逐層覆寫（docs/architecture/frontend/07-ui-system.md §3.1 規則 6）。
 *
 * 根元素（或元件文件註明的那一層）仍用 `className` / `data-testid`；
 * 這三個物件只針對內部各層，鍵是該元件匯出的 `XxxSlot` 聯集。
 */
export interface SlotOverrides<TSlot extends string> {
  /** 疊加在該層預設 class 之後。 */
  classNames?: Partial<Record<TSlot, string>>;
  /** 蓋過該層的預設 inline style（逐屬性合併）。 */
  styles?: Partial<Record<TSlot, CSSProperties>>;
  /** 取代該層的預設 `data-testid`；列表項目的 `data-value` 不受影響。 */
  testIds?: Partial<Record<TSlot, string>>;
}

export interface SlotDefaults {
  style?: CSSProperties;
  testId?: string;
}

export interface SlotAttributes {
  className: string | undefined;
  style: CSSProperties | undefined;
  'data-testid': string | undefined;
}

/** `createSlots()` 的回傳值；要把它傳給子元件時用這個型別。 */
export type SlotResolver<TSlot extends string> = (
  slot: TSlot,
  className?: ClassValue,
  defaults?: SlotDefaults,
) => SlotAttributes;

/**
 * 回傳 `slot(name, className, defaults)`：把某一層的預設值與呼叫端覆寫合併成可以直接攤開的屬性。
 * 攤開後不要再另外寫 `className` / `style` / `data-testid`，否則會蓋掉覆寫。
 */
export function createSlots<TSlot extends string>({
  classNames,
  styles,
  testIds,
}: SlotOverrides<TSlot>): SlotResolver<TSlot> {
  return (slot, className, defaults = {}) => {
    const override = styles?.[slot];
    return {
      className: cn(className, classNames?.[slot]) || undefined,
      style:
        defaults.style && override
          ? { ...defaults.style, ...override }
          : (override ?? defaults.style),
      'data-testid': testIds?.[slot] ?? defaults.testId,
    };
  };
}
