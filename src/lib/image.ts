/** Pixel size of a PNG or JPEG data URL, read from the file header (null when it can't be read). */
export function imageSize(dataUrl: string): { width: number; height: number } | null {
  const comma = dataUrl.indexOf(',');
  if (comma < 0) return null;
  let bin: string;
  try {
    bin = atob(dataUrl.slice(comma + 1, comma + 1 + 80000)); // the header is near the start
  } catch {
    return null;
  }
  const byte = (i: number) => bin.charCodeAt(i) & 0xff;
  const u16 = (i: number) => (byte(i) << 8) | byte(i + 1);
  const u32 = (i: number) => ((byte(i) << 24) | (byte(i + 1) << 16) | (byte(i + 2) << 8) | byte(i + 3)) >>> 0;
  // PNG: signature, then the IHDR chunk with width and height
  if (bin.startsWith('\x89PNG')) {
    const width = u32(16), height = u32(20);
    return width && height ? { width, height } : null;
  }
  // JPEG: walk the segments to the start-of-frame marker
  if (byte(0) === 0xff && byte(1) === 0xd8) {
    let i = 2;
    while (i + 9 < bin.length) {
      if (byte(i) !== 0xff) return null;
      const marker = byte(i + 1);
      const len = u16(i + 2);
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        const height = u16(i + 5), width = u16(i + 7);
        return width && height ? { width, height } : null;
      }
      i += 2 + len;
    }
  }
  return null;
}

/** Logo size on the page: the chosen height, keeping its proportions, but never wider than `maxWidthMm`. */
export function logoSizeMm(dataUrl: string, heightMm: number, maxWidthMm: number): { widthMm: number; heightMm: number } {
  const px = imageSize(dataUrl);
  const aspect = px ? px.width / px.height : 3;
  const widthMm = Math.min(heightMm * aspect, maxWidthMm);
  return { widthMm, heightMm: widthMm / aspect };
}

/** Read an image file as a data URL, scaled down so its longer side is at most `maxPx` (keeps PNG transparency). */
export function readImageFile(file: File, maxPx = 1000): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    reader.onload = () => {
      const src = String(reader.result);
      const img = new Image();
      img.onerror = () => reject(new Error('The image could not be read'));
      img.onload = () => {
        const scale = Math.min(1, maxPx / Math.max(img.naturalWidth, img.naturalHeight));
        if (scale === 1) return resolve(src);
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(img.naturalWidth * scale);
        canvas.height = Math.round(img.naturalHeight * scale);
        canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(file.type === 'image/jpeg' ? canvas.toDataURL('image/jpeg', 0.92) : canvas.toDataURL('image/png'));
      };
      img.src = src;
    };
    reader.readAsDataURL(file);
  });
}
