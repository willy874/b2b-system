import { useEffect, useState } from 'react';

/** `qrcode` 只在需要的元件載入（docs/architecture/backend/21-mfa.md §11：不進主要 bundle）。 */
export function useQrCode(uri: string | undefined, width = 200): string | undefined {
  const [image, setImage] = useState<{ uri: string; dataUrl: string }>();
  useEffect(() => {
    if (!uri) return undefined;
    let cancelled = false;
    void import('qrcode').then(async (QRCode) => {
      const dataUrl = await QRCode.toDataURL(uri, { margin: 1, width });
      if (!cancelled) setImage({ uri, dataUrl });
    });
    return () => {
      cancelled = true;
    };
  }, [uri, width]);
  return image && image.uri === uri ? image.dataUrl : undefined;
}
