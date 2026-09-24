import { Accordion as BaseAccordion } from '@base-ui-components/react/accordion';
import type { ReactNode } from 'react';

import { cn } from '@/shared/utils';

import { Icon } from '../Icon';
import { createSlots } from '../slots';
import type { SlotOverrides } from '../slots';

import styles from './Accordion.module.css';

export interface AccordionItemDescriptor {
  value: string;
  title: ReactNode;
  content: ReactNode;
  disabled?: boolean;
}

/** `className` 落在根元素；其餘各層用 `classNames` / `styles` / `testIds` 覆寫。 */
export type AccordionSlot = 'item' | 'header' | 'trigger' | 'chevron' | 'panel' | 'content';

export interface AccordionProps extends SlotOverrides<AccordionSlot> {
  items: AccordionItemDescriptor[];
  value?: string[];
  defaultValue?: string[];
  onValueChange?: (value: string[]) => void;
  /** 一次只能展開一項。 */
  single?: boolean;
  className?: string;
  'data-testid'?: string;
}

export function Accordion({
  items,
  value,
  defaultValue,
  onValueChange,
  single,
  className,
  classNames,
  styles: styleOverrides,
  testIds,
  ...rest
}: AccordionProps) {
  const slot = createSlots({ classNames, styles: styleOverrides, testIds });
  return (
    <BaseAccordion.Root
      value={value}
      defaultValue={defaultValue}
      onValueChange={(next: unknown) => onValueChange?.((next as string[]) ?? [])}
      multiple={!single}
      className={cn(styles.root, className)}
      {...rest}
    >
      {items.map((item) => (
        <BaseAccordion.Item
          key={item.value}
          value={item.value}
          disabled={item.disabled}
          {...slot('item', styles.item)}
        >
          <BaseAccordion.Header {...slot('header', styles.header)}>
            <BaseAccordion.Trigger
              {...slot('trigger', styles.trigger, { testId: 'accordion-trigger' })}
              data-value={item.value}
            >
              <span>{item.title}</span>
              <Icon name="chevron-down" size={16} {...slot('chevron', styles.chevron)} />
            </BaseAccordion.Trigger>
          </BaseAccordion.Header>
          <BaseAccordion.Panel {...slot('panel', styles.panel)}>
            <div {...slot('content', styles.content)}>{item.content}</div>
          </BaseAccordion.Panel>
        </BaseAccordion.Item>
      ))}
    </BaseAccordion.Root>
  );
}
