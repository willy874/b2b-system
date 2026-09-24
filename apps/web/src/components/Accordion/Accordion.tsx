import { Accordion as BaseAccordion } from '@base-ui-components/react/accordion';
import type { ReactNode } from 'react';

import { cn } from '@/shared/utils';

import { Icon } from '../Icon';
import { createSlots } from '../slots';
import type { SlotOverrides } from '../slots';

import './Accordion.css';

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
  styles,
  testIds,
  ...rest
}: AccordionProps) {
  const slot = createSlots({ classNames, styles, testIds });
  return (
    <BaseAccordion.Root
      value={value}
      defaultValue={defaultValue}
      onValueChange={(next: unknown) => onValueChange?.((next as string[]) ?? [])}
      multiple={!single}
      className={cn('ge-accordion', className)}
      {...rest}
    >
      {items.map((item) => (
        <BaseAccordion.Item
          key={item.value}
          value={item.value}
          disabled={item.disabled}
          {...slot('item', 'ge-accordion__item')}
        >
          <BaseAccordion.Header {...slot('header', 'ge-accordion__header')}>
            <BaseAccordion.Trigger
              {...slot('trigger', 'ge-accordion__trigger', { testId: 'accordion-trigger' })}
              data-value={item.value}
            >
              <span>{item.title}</span>
              <Icon name="chevron-down" size={16} {...slot('chevron', 'ge-accordion__chevron')} />
            </BaseAccordion.Trigger>
          </BaseAccordion.Header>
          <BaseAccordion.Panel {...slot('panel', 'ge-accordion__panel')}>
            <div {...slot('content', 'ge-accordion__content')}>{item.content}</div>
          </BaseAccordion.Panel>
        </BaseAccordion.Item>
      ))}
    </BaseAccordion.Root>
  );
}
