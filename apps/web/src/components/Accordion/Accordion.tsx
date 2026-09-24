import { Accordion as BaseAccordion } from '@base-ui-components/react/accordion';
import type { ReactNode } from 'react';

import { cn } from '@/shared/utils';

import { Icon } from '../Icon';

import './Accordion.css';

export interface AccordionItemDescriptor {
  value: string;
  title: ReactNode;
  content: ReactNode;
  disabled?: boolean;
}

export interface AccordionProps {
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
  ...rest
}: AccordionProps) {
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
          className="ge-accordion__item"
        >
          <BaseAccordion.Header className="ge-accordion__header">
            <BaseAccordion.Trigger
              className="ge-accordion__trigger"
              data-testid="accordion-trigger"
              data-value={item.value}
            >
              <span>{item.title}</span>
              <Icon name="chevron-down" size={16} className="ge-accordion__chevron" />
            </BaseAccordion.Trigger>
          </BaseAccordion.Header>
          <BaseAccordion.Panel className="ge-accordion__panel">
            <div className="ge-accordion__content">{item.content}</div>
          </BaseAccordion.Panel>
        </BaseAccordion.Item>
      ))}
    </BaseAccordion.Root>
  );
}
