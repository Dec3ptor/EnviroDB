import { useEffect, useState } from 'react';
import { photoUrl } from '../lib/photos';

/**
 * A photo in the shared folder as a URL for an <img>: undefined while it loads (or until `load`), null when the
 * folder hasn't got it. The URL is let go when the photo is no longer shown.
 */
export function usePhotoUrl(path: string, load = true): string | null | undefined {
  // the URL with the photo it's for (another photo's, let go of already, is never given)
  const [got, setGot] = useState<{ path: string; url: string | null } | undefined>(undefined);
  useEffect(() => {
    if (!load) return;
    let gone = false;
    let made: string | null = null;
    photoUrl(path).then((u) => {
      if (gone) {
        if (u) URL.revokeObjectURL(u);
        return;
      }
      made = u;
      setGot({ path, url: u });
    });
    return () => {
      gone = true;
      if (made) URL.revokeObjectURL(made);
    };
  }, [path, load]);
  return got && got.path === path ? got.url : undefined;
}
