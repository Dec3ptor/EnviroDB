import { useEffect, useState, type RefObject } from 'react';
import { Affix, Button } from '@mantine/core';
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
