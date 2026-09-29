import { render } from '@testing-library/react';
import { createRef } from 'react';
import type { ReactElement, RefObject } from 'react';
import { describe, expect, it } from 'vitest';

import { Button, IconButton } from '../Button';
import { Empty } from '../Empty';
import { Field } from '../Field';
import { Input, Textarea } from '../Input';
import { Skeleton } from '../Skeleton';
import { Spinner } from '../Spinner';
import { VirtualList } from '../VirtualList';

/**
 * React 19 把 `ref` 當成一般 prop 傳給函式元件，所以只要元件把 `...rest`
 * 攤到根元素上（或交給 Base UI part），呼叫端就能拿到 DOM 節點。
 * 這支測試把 docs/architecture/frontend/07-ui-system.md §3.1 的第 2 條規則釘住。
 * 複製自 apps/backstage，只留 apps/auth 有複製的元件（docs/adr/0019-sso-identity-platform.md D14）。
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
  ['Input', (ref) => <Input ref={ref as RefObject<HTMLInputElement>} aria-label="x" />],
  ['Textarea', (ref) => <Textarea ref={ref as RefObject<HTMLTextAreaElement>} aria-label="x" />],
  ['Skeleton', (ref) => <Skeleton ref={ref as RefObject<HTMLSpanElement>} />],
  ['Spinner', (ref) => <Spinner ref={ref as RefObject<HTMLOutputElement>} />],
  ['Empty', (ref) => <Empty ref={ref as RefObject<HTMLDivElement>} title="x" />],
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
