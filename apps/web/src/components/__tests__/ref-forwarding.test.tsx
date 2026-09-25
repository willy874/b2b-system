import { render } from '@testing-library/react';
import { createRef } from 'react';
import type { ReactElement, RefObject } from 'react';
import { describe, expect, it } from 'vitest';

import { Avatar } from '../Avatar';
import { Breadcrumbs } from '../Breadcrumbs';
import { Button, IconButton } from '../Button';
import { Chip } from '../Chip';
import { BoxEllipsis, ButtonEllipsis, TextEllipsis } from '../Ellipsis';
import { Empty } from '../Empty';
import { Field } from '../Field';
import { Input, Textarea } from '../Input';
import { JsonViewer } from '../JsonViewer';
import { Link } from '../Link';
import { Pagination } from '../Pagination';
import { Progress } from '../Progress';
import { ScrollArea } from '../ScrollArea';
import { Select } from '../Select';
import { Separator } from '../Separator';
import { Skeleton } from '../Skeleton';
import { Spinner } from '../Spinner';
import { Paragraph, Text, Title, Typography } from '../Typography';
import { VirtualList } from '../VirtualList';

/**
 * React 19 把 `ref` 當成一般 prop 傳給函式元件，所以只要元件把 `...rest`
 * 攤到根元素上（或交給 Base UI part），呼叫端就能拿到 DOM 節點。
 * 這支測試把 docs/architecture/frontend/07-ui-system.md §3.1 的第 2 條規則釘住。
 */
const cases: Array<[string, (ref: RefObject<HTMLElement | null>) => ReactElement]> = [
  ['Button', (ref) => <Button ref={ref as RefObject<HTMLButtonElement>}>x</Button>],
  [
    'IconButton',
    (ref) => (
      <IconButton ref={ref as RefObject<HTMLButtonElement>} aria-label="x">
        x
      </IconButton>
    ),
  ],
  [
    'ButtonEllipsis',
    (ref) => (
      <ButtonEllipsis ref={ref as RefObject<HTMLDivElement>} items={[{ key: 'x', label: 'x' }]} />
    ),
  ],
  ['BoxEllipsis', (ref) => <BoxEllipsis ref={ref as RefObject<HTMLDivElement>}>x</BoxEllipsis>],
  ['TextEllipsis', (ref) => <TextEllipsis ref={ref as RefObject<HTMLSpanElement>}>x</TextEllipsis>],
  ['Input', (ref) => <Input ref={ref as RefObject<HTMLInputElement>} aria-label="x" />],
  ['Textarea', (ref) => <Textarea ref={ref as RefObject<HTMLTextAreaElement>} aria-label="x" />],
  ['Link', (ref) => <Link ref={ref as RefObject<HTMLAnchorElement>} href="#x" />],
  ['Chip', (ref) => <Chip ref={ref as RefObject<HTMLSpanElement>}>x</Chip>],
  ['Typography', (ref) => <Typography ref={ref}>x</Typography>],
  ['Title', (ref) => <Title ref={ref}>x</Title>],
  ['Text', (ref) => <Text ref={ref}>x</Text>],
  ['Paragraph', (ref) => <Paragraph ref={ref}>x</Paragraph>],
  ['Skeleton', (ref) => <Skeleton ref={ref as RefObject<HTMLSpanElement>} />],
  ['Spinner', (ref) => <Spinner ref={ref as RefObject<HTMLOutputElement>} />],
  ['Separator', (ref) => <Separator ref={ref as RefObject<HTMLDivElement>} />],
  ['Avatar', (ref) => <Avatar ref={ref as RefObject<HTMLSpanElement>} name="A" />],
  ['Empty', (ref) => <Empty ref={ref as RefObject<HTMLDivElement>} title="x" />],
  [
    'Progress',
    (ref) => <Progress ref={ref as RefObject<HTMLDivElement>} value={10} aria-label="x" />,
  ],
  [
    'Pagination',
    (ref) => <Pagination ref={ref} offset={0} limit={20} total={0} onChange={() => {}} />,
  ],
  [
    'Breadcrumbs',
    (ref) => <Breadcrumbs ref={ref as RefObject<HTMLElement>} items={[{ key: 'a', label: 'a' }]} />,
  ],
  ['ScrollArea', (ref) => <ScrollArea ref={ref as RefObject<HTMLDivElement>}>x</ScrollArea>],
  [
    'Select',
    (ref) => <Select ref={ref as RefObject<HTMLButtonElement>} options={[]} aria-label="x" />,
  ],
  [
    'VirtualList',
    (ref) => (
      <VirtualList
        ref={ref as RefObject<HTMLDivElement>}
        items={['x']}
        getKey={String}
        renderItem={String}
      />
    ),
  ],
  ['JsonViewer', (ref) => <JsonViewer ref={ref} value={{}} />],
  [
    'Field',
    (ref) => (
      <Field ref={ref as RefObject<HTMLDivElement>} label="x">
        <Input />
      </Field>
    ),
  ],
];

describe('ref 透傳', () => {
  for (const [name, renderCase] of cases) {
    it(`${name} 會把 ref 交到 DOM 節點上`, () => {
      const ref = createRef<HTMLElement>();
      render(renderCase(ref));
      expect(ref.current, `${name} 沒有把 ref 傳下去`).toBeInstanceOf(HTMLElement);
    });
  }
});
