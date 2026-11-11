// A document's pages as pictures: a PDF drawn page by page (pdf.js), a picture as it is – to print a lab's form with a
// round's paperwork, or to put a lab's report at the back of a report (Word and PDF both take pictures).

import { imageSize, readFigureFile } from './image';
import { loadPdfJs } from './pdfjs';

export interface PageImage {
  /** A JPEG. */
  dataUrl: string;
  /** The page's own size, in PDF points (1/72 inch). */
  width: number;
  height: number;
}

export interface FilePages {
  pages: PageImage[];
  /** How many pages the document has (more than `pages` when it's cut short). */
  total: number;
}

export const isPdfFile = (f: { name: string; type?: string }): boolean => /\.pdf$/i.test(f.name) || f.type === 'application/pdf';
export const isPictureFile = (f: { name: string; type?: string }): boolean => /\.(png|jpe?g)$/i.test(f.name) || /^image\/(png|jpeg)$/.test(f.type ?? '');
/** Whether a file's pages can be drawn: a PDF or a picture. */
export const hasPages = (f: { name: string; type?: string }): boolean => isPdfFile(f) || isPictureFile(f);

/** Bigger than this a PDF isn't drawn (it would take the browser's memory). */
const MAX_BYTES = 80 * 1024 * 1024;

/**
 * A file's pages as pictures: a PDF's, drawn at `dpi` (200 prints a form crisply; 150 is plenty for a report read on
 * screen) – the first `maxPages` of them; a picture is one page. Anything else has none.
 */
export async function pagesOf(file: File, opts: { dpi?: number; maxPages?: number; quality?: number } = {}): Promise<FilePages> {
  const dpi = opts.dpi ?? 200;
  const max = opts.maxPages ?? 60;
  if (isPictureFile(file)) {
    const dataUrl = await readFigureFile(file, 2400);
    const size = imageSize(dataUrl);
    if (!size) return { pages: [], total: 0 };
    // a picture has no size on paper: it's fitted to the page it goes on
    return { pages: [{ dataUrl, width: size.width, height: size.height }], total: 1 };
  }
  if (!isPdfFile(file)) return { pages: [], total: 0 };
  if (file.size > MAX_BYTES) throw new Error(`${file.name} is too big to draw (${Math.round(file.size / 1024 / 1024)} MB).`);
  const pdfjs = await loadPdfJs();
  const task = pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) });
  try {
    const doc = await task.promise;
    const pages: PageImage[] = [];
    for (let n = 1; n <= Math.min(max, doc.numPages); n++) {
      const page = await doc.getPage(n);
      const base = page.getViewport({ scale: 1 });
      // no page drawn bigger than about 9 megapixels, whatever its size on paper
      const scale = Math.min(dpi / 72, Math.sqrt(9_000_000 / Math.max(1, base.width * base.height)));
      const viewport = page.getViewport({ scale });
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.floor(viewport.width));
      canvas.height = Math.max(1, Math.floor(viewport.height));
      await page.render({ canvas, viewport }).promise;
      pages.push({ dataUrl: canvas.toDataURL('image/jpeg', opts.quality ?? 0.9), width: base.width, height: base.height });
      // give the memory back before the next page
      canvas.width = 0;
      canvas.height = 0;
      page.cleanup();
    }
    return { pages, total: doc.numPages };
  } finally {
    await task.destroy();
  }
}

/** A page fitted inside a box (points), keeping its shape – never made bigger than `grow` times its own size. */
export function fitPage(page: { width: number; height: number }, boxW: number, boxH: number, grow = Infinity): { width: number; height: number } {
  const k = Math.min(boxW / Math.max(1, page.width), boxH / Math.max(1, page.height), grow);
  return { width: page.width * k, height: page.height * k };
}
