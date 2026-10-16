import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { ActionIcon, Alert, Badge, Group, Loader, Text, Tooltip } from '@mantine/core';
import { IconZoomIn, IconZoomOut, IconZoomReset } from '@tabler/icons-react';
import type { PDFDocumentLoadingTask, PDFDocumentProxy, RenderTask } from 'pdfjs-dist/legacy/build/pdf.mjs';
import type { ReportDoc } from './model';
import { pdfBytes } from './pdf';
import { loadPdfJs } from '../lib/pdfjs';

// The preview shows the real PDF – the same file "Download PDF" saves – so what you see is what you get.


interface PageSize {
  width: number; // PDF points
  height: number;
}

const ZOOMS = [1, 1.5, 2, 3];

function PdfPage({ pdf, n, width, height, label, scroller }: { pdf: PDFDocumentProxy | null; n: number; width: number; height: number; label: string; scroller?: RefObject<HTMLDivElement | null> }) {
  const holder = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const el = holder.current;
    if (!el) return;
    // draw pages as they come near: near the preview's own scroll area when it has one, else the window
    const io = new IntersectionObserver(([e]) => setVisible(e.isIntersecting), { root: scroller?.current ?? null, rootMargin: '800px 0px' });
    io.observe(el);
    return () => io.disconnect();
  }, [scroller]);
  useEffect(() => {
    const c = canvas.current;
    if (!c || !pdf) return;
    if (!visible) {
      // free the memory of pages that are well out of view
      c.width = 0;
      c.height = 0;
      return;
    }
    let cancelled = false;
    let task: RenderTask | null = null;
    void (async () => {
      try {
        const page = await pdf.getPage(n);
        if (cancelled) return;
        const dpr = Math.min(2, window.devicePixelRatio || 1);
        const viewport = page.getViewport({ scale: (width / page.getViewport({ scale: 1 }).width) * dpr });
        const off = document.createElement('canvas');
        off.width = Math.floor(viewport.width);
        off.height = Math.floor(viewport.height);
        task = page.render({ canvas: off, viewport });
        await task.promise;
        if (cancelled) return;
        // swap in the finished page in one go, so an update never flashes blank
        c.width = off.width;
        c.height = off.height;
        c.getContext('2d')?.drawImage(off, 0, 0);
      } catch {
        // cancelled or superseded by a newer PDF
      }
    })();
    return () => {
      cancelled = true;
      task?.cancel();
    };
  }, [pdf, n, width, visible]);
  return (
    <div ref={holder} style={{ width, margin: '0 auto 16px' }} data-pdf-page={n} data-orientation={width > height ? 'landscape' : 'portrait'}>
      <div style={{ width, height, background: '#fff', boxShadow: '0 1px 3px rgba(0,0,0,0.18), 0 6px 18px rgba(0,0,0,0.08)' }}>
        <canvas ref={canvas} style={{ width, height, display: 'block' }} aria-label={label} />
      </div>
      <Text size="xs" c="dimmed" ta="center" mt={4}>
        {label}
      </Text>
    </div>
  );
}

/**
 * Pages of the report's PDF, drawn to scale. With `fill` the preview takes the height it is given and scrolls its
 * pages itself (the page count and zoom stay in view), so reading the preview doesn't scroll the whole page.
 */
export function PdfPreview({ doc, building, fill }: { doc: ReportDoc | null; building?: boolean; fill?: boolean }) {
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null);
  const current = useRef<PDFDocumentLoadingTask | null>(null);
  const [pages, setPages] = useState<PageSize[]>([]);
  const [shown, setShown] = useState<ReportDoc | null>(null); // the report the pages on screen are for
  const [making, setMaking] = useState(false);
  const [error, setError] = useState('');
  const [zoom, setZoom] = useState(1);
  const box = useRef<HTMLDivElement>(null);
  const [avail, setAvail] = useState(0);

  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setAvail(el.clientWidth));
    ro.observe(el);
    setAvail(el.clientWidth);
    return () => ro.disconnect();
  }, []);
  useEffect(() => () => void current.current?.destroy(), []);

  useEffect(() => {
    if (!doc) return;
    let cancelled = false;
    setMaking(true);
    void (async () => {
      try {
        const [lib, bytes] = await Promise.all([loadPdfJs(), pdfBytes(doc)]);
        if (cancelled) return;
        const task = lib.getDocument({ data: bytes });
        const next = await task.promise;
        const sizes: PageSize[] = [];
        for (let i = 1; i <= next.numPages; i++) {
          const v = (await next.getPage(i)).getViewport({ scale: 1 });
          sizes.push({ width: v.width, height: v.height });
        }
        if (cancelled) {
          void task.destroy();
          return;
        }
        const old = current.current;
        current.current = task;
        setPdf(next);
        setPages(sizes);
        setShown(doc);
        setError('');
        if (old) window.setTimeout(() => void old.destroy(), 1500);
      } catch (e) {
        if (!cancelled) {
          setError((e as Error).message);
          setShown(doc);
        }
      } finally {
        if (!cancelled) setMaking(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [doc]);

  const widest = Math.max(1, ...pages.map((p) => p.width));
  const scale = (Math.max(160, avail - 24) / widest) * zoom; // one scale for every page, so sizes compare truly
  const landscape = pages.filter((p) => p.width > p.height).length;
  const busy = making || !!building || (!!doc && doc !== shown);

  return (
    <div data-ready={!busy} style={fill ? { display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 } : undefined}>
      <Group justify="space-between" mb="xs" wrap="wrap" gap="xs">
        <Group gap={6}>
          <Text size="sm" fw={500}>
            {pages.length ? `${pages.length} page${pages.length === 1 ? '' : 's'}` : 'Preview'}
          </Text>
          {pages.length > 0 && (
            <Badge variant="light" color="gray">
              {landscape === 0 ? 'Portrait' : landscape === pages.length ? 'Landscape' : `${landscape} landscape`}
            </Badge>
          )}
          {busy && <Loader size="xs" />}
        </Group>
        <Group gap={4}>
          <Tooltip label="Zoom out">
            <ActionIcon variant="default" disabled={zoom === ZOOMS[0]} onClick={() => setZoom(ZOOMS[Math.max(0, ZOOMS.indexOf(zoom) - 1)])} aria-label="Zoom out">
              <IconZoomOut size={16} />
            </ActionIcon>
          </Tooltip>
          <Tooltip label="Fit to width">
            <ActionIcon variant="default" disabled={zoom === 1} onClick={() => setZoom(1)} aria-label="Fit to width">
              <IconZoomReset size={16} />
            </ActionIcon>
          </Tooltip>
          <Tooltip label="Zoom in">
            <ActionIcon variant="default" disabled={zoom === ZOOMS[ZOOMS.length - 1]} onClick={() => setZoom(ZOOMS[Math.min(ZOOMS.length - 1, ZOOMS.indexOf(zoom) + 1)])} aria-label="Zoom in">
              <IconZoomIn size={16} />
            </ActionIcon>
          </Tooltip>
        </Group>
      </Group>
      {error && (
        <Alert color="red" mb="sm">
          The preview couldn't be drawn: {error}
        </Alert>
      )}
      <div
        ref={box}
        data-pdf-scroller={fill || undefined}
        style={{
          overflowX: zoom > 1 ? 'auto' : 'hidden',
          ...(fill ? { flex: 1, minHeight: 0, overflowY: 'auto', overscrollBehavior: 'contain', paddingTop: 2 } : {}),
          opacity: busy && pages.length ? 0.75 : 1,
          transition: 'opacity 150ms',
        }}
      >
        {!pages.length && !error && (
          <Group justify="center" p="xl">
            <Loader />
          </Group>
        )}
        <div style={{ width: zoom > 1 ? widest * scale : undefined }}>
          {pages.map((p, i) => (
            <PdfPage key={i} pdf={pdf} n={i + 1} width={p.width * scale} height={p.height * scale} label={`Page ${i + 1} of ${pages.length}${p.width > p.height ? ' · landscape' : ''}`} scroller={fill ? box : undefined} />
          ))}
        </div>
      </div>
    </div>
  );
}
