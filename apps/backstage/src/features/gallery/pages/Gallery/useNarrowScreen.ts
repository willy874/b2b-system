import { useEffect, useState } from 'react';

import { GALLERY_NARROW_WIDTH } from '../../constants';

const QUERY = `(max-width: ${GALLERY_NARROW_WIDTH - 1}px)`;

/** 窄螢幕（手機）：預設方格、最小的列高。 */
export function useNarrowScreen(): boolean {
  const [narrow, setNarrow] = useState(
    () => typeof matchMedia === 'function' && matchMedia(QUERY).matches,
  );
  useEffect(() => {
    if (typeof matchMedia !== 'function') return undefined;
    const media = matchMedia(QUERY);
    const onChange = () => setNarrow(media.matches);
    media.addEventListener?.('change', onChange);
    return () => media.removeEventListener?.('change', onChange);
  }, []);
  return narrow;
}
