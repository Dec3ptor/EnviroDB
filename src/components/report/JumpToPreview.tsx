import { useEffect, useRef, useState, type CSSProperties, type RefObject } from 'react';
import { Affix, Button, useMantineTheme } from '@mantine/core';
import { useMediaQuery } from '@mantine/hooks';
import { IconArrowUp, IconEye } from '@tabler/icons-react';

/**
 * On narrow screens the preview sits below the settings: a floating button jumps to the preview and back, so a
 * change can be checked without scrolling past every section.
 */
export function JumpToPreview({ preview, back, backLabel = 'Back to settings', from = 'lg' }: { preview: RefObject<HTMLElement | null>; back: RefObject<HTMLElement | null>; backLabel?: string; from?: 'lg' | 'xl' }) {
  const [atPreview, setAtPreview] = useState(false);
  useEffect(() => {
    const el = preview.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => setAtPreview(e.isIntersecting), { threshold: 0.1 });
    io.observe(el);
    return () => io.disconnect();
  }, [preview]);
  const go = () => (atPreview ? back : preview).current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  return (
    <Affix position={{ bottom: 16, right: 16 }} hiddenFrom={from}>
      <Button radius="xl" size="sm" leftSection={atPreview ? <IconArrowUp size={16} /> : <IconEye size={16} />} onClick={go} style={{ boxShadow: 'var(--mantine-shadow-md)' }}>
        {atPreview ? backLabel : 'Preview'}
      </Button>
    </Affix>
  );
}

/**
 * Side by side with the settings (from the `lg` / `xl` breakpoint), the preview card sticks below the app header
 * and is sized to the space left on screen, so the whole card is always in view and its pages scroll inside it
 * while the settings stay put. Stacked on smaller screens, it scrolls with the page.
 */
export function usePreviewPane(card: RefObject<HTMLElement | null>, from: 'lg' | 'xl' = 'lg'): { fill: boolean; style: CSSProperties } {
  const theme = useMantineTheme();
  const sideBySide = !!useMediaQuery(`(min-width: ${theme.breakpoints[from]})`, true, { getInitialValueInEffect: false });
  // the card can appear after the first render (pages show a loader first), so look for it after every render
  const attached = useRef<HTMLElement | null>(null);
  const detach = useRef<() => void>(() => {});
  useEffect(() => {
    const el = sideBySide ? card.current : null;
    if (el === attached.current) return;
    detach.current();
    attached.current = el;
    detach.current = el ? fitToScreen(el) : () => {};
  });
  useEffect(() => () => detach.current(), []);
  return { fill: sideBySide, style: sideBySide ? { position: 'sticky', top: STICK_TOP } : {} };
}

/** Just below the app header (56 px) and the page padding. */
const STICK_TOP = 72;

/** Keep the card's height to the space from where it is on screen to just above the bottom edge; returns the undo. */
function fitToScreen(el: HTMLElement): () => void {
  let frame = 0;
  const fit = () => {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => {
      const top = Math.max(STICK_TOP, el.getBoundingClientRect().top);
      el.style.height = `${Math.max(320, window.innerHeight - top - 16)}px`;
    });
  };
  fit();
  const ro = new ResizeObserver(fit); // anything above the card changing height moves it
  ro.observe(document.body);
  window.addEventListener('scroll', fit, { passive: true });
  window.addEventListener('resize', fit);
  return () => {
    cancelAnimationFrame(frame);
    ro.disconnect();
    window.removeEventListener('scroll', fit);
    window.removeEventListener('resize', fit);
    el.style.height = '';
  };
}
