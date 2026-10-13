import { useEffect, useState, type CSSProperties } from 'react';
import { Badge, Button, Card, ColorInput, FileButton, Group, Loader, NumberInput, SimpleGrid, Stack, Switch, Text, TextInput, Textarea, Title } from '@mantine/core';
import { modals } from '@mantine/modals';
import { notifications } from '@mantine/notifications';
import { IconFileTypeDocx, IconPhoto, IconTrash } from '@tabler/icons-react';
import { saveSettings } from '../../db/db';
import type { Letterhead, LetterheadItem, LetterheadPage } from '../../db/types';
import { useSettings } from '../../hooks/useSettings';
import { logoSizeMm, readImageFile } from '../../lib/image';
import { MoreOptions } from '../common';

const SMALL = { sizePt: 7, color: '#555555' };

/** A plain letterhead to start from by hand: your company on page 1's footer, page numbers on the others. */
function blankLetterhead(company: string): Letterhead {
  return {
    marginsMm: { top: 30, right: 20, bottom: 25, left: 20, header: 10, footer: 10 },
    first: { header: [], footer: company ? [{ kind: 'text', align: 'left', runs: [{ text: company, ...SMALL }] }] : [] },
    other: { header: [], footer: [{ kind: 'text', align: 'right', runs: [{ text: '{page}', ...SMALL }] }] },
  };
}

const textLines = (items: LetterheadItem[]) => items.filter((it) => it.kind === 'text').map((it) => (it.kind === 'text' ? it.runs.map((r) => r.text).join('') : ''));

/** The part with its text replaced by these lines – each keeping the look of the line it replaces – and its pictures kept. */
function withLines(items: LetterheadItem[], value: string): LetterheadItem[] {
  const texts = items.filter((it): it is Extract<LetterheadItem, { kind: 'text' }> => it.kind === 'text');
  const lines = value.split('\n');
  const made: LetterheadItem[] = lines
    .map((line, i) => {
      const like = texts[i] ?? texts[texts.length - 1];
      const style = like?.runs[0] ? { color: like.runs[0].color, sizePt: like.runs[0].sizePt, bold: like.runs[0].bold, italic: like.runs[0].italic } : SMALL;
      return { kind: 'text' as const, align: texts[i]?.align ?? 'left', ...(texts[i]?.dx !== undefined ? { dx: texts[i].dx } : like?.dx !== undefined && !texts[i] && like.align === 'left' ? { dx: like.dx } : {}), runs: [{ text: line, ...style }] };
    })
    .filter((it) => it.runs[0].text.trim());
  const firstText = items.findIndex((it) => it.kind === 'text');
  const pictures = items.filter((it) => it.kind === 'image');
  if (firstText < 0) return [...pictures, ...made];
  const before = items.slice(0, firstText).filter((it) => it.kind === 'image');
  const after = items.slice(firstText).filter((it) => it.kind === 'image');
  return [...before, ...made, ...after];
}

/** A sketch of a page with the letterhead's header and footer, to check what came from the Word file. */
function PageSketch({ lh, page, label }: { lh: Letterhead; page: LetterheadPage; label: string }) {
  const W = 168;
  const k = W / 210; // px per mm
  const m = lh.marginsMm;
  const item = (it: LetterheadItem, i: number) => {
    const style: CSSProperties = { marginLeft: it.align === 'left' && it.dx ? it.dx * k : 0, lineHeight: 1.05, whiteSpace: 'nowrap', overflow: 'hidden' };
    if (it.kind === 'image') return <img key={i} src={it.dataUrl} alt="" style={{ ...style, width: it.widthMm * k, height: it.heightMm * k, display: 'block', marginLeft: it.align === 'right' ? 'auto' : style.marginLeft }} />;
    const size = Math.max(2.4, Math.max(...it.runs.map((r) => r.sizePt ?? 8)) * 0.3528 * k); // the line's height, as on the page
    return (
      <div key={i} style={{ ...style, textAlign: it.align, fontSize: size, lineHeight: 1.2 }}>
        {it.runs.map((r, j) => (
          <span key={j} style={{ color: r.color ?? '#555', fontSize: Math.max(2.4, (r.sizePt ?? 8) * 0.3528 * k), fontWeight: r.bold ? 700 : 400, fontStyle: r.italic ? 'italic' : undefined }}>
            {r.text.replace(/\{page\}/g, label === 'First page' ? '1' : '2').replace(/\{pages\}/g, '3')}
          </span>
        ))}
      </div>
    );
  };
  const column = (items: LetterheadItem[], align: 'left' | 'center' | 'right') => (
    <div style={{ flex: 1, textAlign: align, minWidth: 0 }}>{items.filter((it) => it.align === align).map(item)}</div>
  );
  const band = (items: LetterheadItem[]) => (
    <div style={{ display: 'flex', gap: 2 }}>
      {column(items, 'left')}
      {column(items, 'center')}
      {column(items, 'right')}
    </div>
  );
  return (
    <div>
      <Text size="xs" c="dimmed" mb={2}>
        {label}
      </Text>
      <div style={{ position: 'relative', width: W, height: W * (297 / 210), background: '#fff', boxShadow: '0 1px 4px rgba(0,0,0,.25)', overflow: 'hidden' }}>
        <div style={{ position: 'absolute', top: m.header * k, left: m.left * k, right: m.right * k }}>{band(page.header)}</div>
        <div style={{ position: 'absolute', top: m.top * k, left: (m.left + (lh.indentMm ?? 0)) * k, right: m.right * k }}>
          {[0.9, 1, 0.95, 0.6, 0, 1, 0.85, 1, 0.7].map((w, i) => (
            <div key={i} style={{ height: 2, width: `${w * 100}%`, background: w ? '#d9dde3' : 'transparent', marginBottom: 3 }} />
          ))}
        </div>
        <div style={{ position: 'absolute', bottom: m.footer * k, left: m.left * k, right: m.right * k }}>{band(page.footer)}</div>
      </div>
    </div>
  );
}

/** The company letterhead (Settings): read from a Word file, or set up by hand. */
export function LetterheadCard() {
  const settings = useSettings();
  const lh = settings.letterhead;
  const [busy, setBusy] = useState(false);
  const save = (next: Letterhead | undefined) => saveSettings({ letterhead: next });
  const set = (patch: Partial<Letterhead>) => lh && save({ ...lh, ...patch });

  // text boxes keep what is typed until they lose focus
  const [draft, setDraft] = useState<Record<string, string>>({});
  useEffect(() => setDraft({}), [lh]);
  const lines = (key: 'first.footer' | 'other.footer' | 'first.header' | 'other.header') => {
    if (!lh) return '';
    const [pg, part] = key.split('.') as ['first' | 'other', 'header' | 'footer'];
    return draft[key] ?? textLines(lh[pg][part]).join('\n');
  };
  const commit = (key: 'first.footer' | 'other.footer' | 'first.header' | 'other.header') => {
    if (!lh || draft[key] === undefined) return;
    const [pg, part] = key.split('.') as ['first' | 'other', 'header' | 'footer'];
    const pageNow = { ...lh[pg], [part]: withLines(lh[pg][part], draft[key]) };
    // a letterhead without a different first page shares its parts between the two
    const shared = lh.first === lh.other || JSON.stringify(lh.first) === JSON.stringify(lh.other);
    void save({ ...lh, [pg]: pageNow, ...(shared ? { first: pageNow, other: pageNow } : {}) });
  };

  const upload = async (file: File | null) => {
    if (!file) return;
    if (!/\.(docx|dotx|docm|dotm)$/i.test(file.name)) {
      notifications.show({ color: 'orange', title: 'Not a Word file', message: 'Choose a .docx or .dotx file. An older .doc file needs opening in Word and saving as .docx first.' });
      return;
    }
    setBusy(true);
    try {
      const { readLetterhead } = await import('../../reports/wordLetterhead');
      const next = await readLetterhead(await file.arrayBuffer(), file.name);
      await save(next);
      const logo = [...next.first.header, ...next.other.header].some((it) => it.kind === 'image');
      notifications.show({ color: 'teal', title: 'Letterhead added', message: `Letter reports now print on it.${logo ? '' : ' No logo was found in its header – add one below if you need it.'} Check it below.` });
    } catch (e) {
      notifications.show({ color: 'red', title: 'That Word file could not be read', message: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };

  const logos = lh ? [...lh.first.header, ...lh.other.header].filter((it): it is Extract<LetterheadItem, { kind: 'image' }> => it.kind === 'image') : [];
  const setLogo = async (file: File | null) => {
    if (!file || !lh) return;
    try {
      const dataUrl = await readImageFile(file, 900);
      const size = logoSizeMm(dataUrl, 12, 70);
      const swap = (items: LetterheadItem[], always: boolean): LetterheadItem[] => {
        const i = items.findIndex((it) => it.kind === 'image');
        if (i < 0) return always ? [{ kind: 'image', align: 'left', dataUrl, ...size }, ...items] : items;
        const old = items[i] as Extract<LetterheadItem, { kind: 'image' }>;
        const h = old.heightMm; // keep the size the letterhead had
        const fit = logoSizeMm(dataUrl, h, 90);
        return items.map((it, k) => (k === i ? { ...old, dataUrl, ...fit } : it));
      };
      const hadOther = lh.other.header.some((it) => it.kind === 'image');
      await save({ ...lh, first: { ...lh.first, header: swap(lh.first.header, true) }, other: { ...lh.other, header: swap(lh.other.header, !hadOther && lh.first !== lh.other) } });
    } catch (e) {
      notifications.show({ color: 'red', message: (e as Error).message });
    }
  };
  const removeLogo = () => lh && save({ ...lh, first: { ...lh.first, header: lh.first.header.filter((it) => it.kind !== 'image') }, other: { ...lh.other, header: lh.other.header.filter((it) => it.kind !== 'image') } });

  return (
    <Card>
      <Group justify="space-between" mb={4} wrap="wrap">
        <Title order={4}>Letterhead</Title>
        {lh ? <Badge variant="light">{lh.fileName ? 'From a Word file' : 'Set up by hand'}</Badge> : <Badge color="gray">Not set up</Badge>}
      </Group>
      <Text size="sm" c="dimmed" mb="sm">
        Letter reports – the annual and monitoring event letters, and any template set to use it – print on your company letterhead: its logo, address, page numbers, margins and fonts. Upload your company’s Word letter template, or any letter or report written on it. Only the letterhead is kept (none of the
        document’s text), and it is shared with everyone in the workspace.
      </Text>
      <Group gap="xs" mb={lh ? 'md' : 0}>
        <FileButton accept=".docx,.dotx,.docm,.dotm,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.openxmlformats-officedocument.wordprocessingml.template" onChange={(f) => void upload(f)}>
          {(p) => (
            <Button {...p} size="xs" leftSection={busy ? <Loader size={14} color="white" /> : <IconFileTypeDocx size={16} />} disabled={busy}>
              {lh?.fileName ? 'Use another Word file' : 'Use a Word file (.docx, .dotx)'}
            </Button>
          )}
        </FileButton>
        {!lh && (
          <Button size="xs" variant="default" onClick={() => void save(blankLetterhead(settings.company))}>
            Set up by hand
          </Button>
        )}
        {lh && (
          <Button
            size="xs"
            variant="subtle"
            color="red"
            leftSection={<IconTrash size={14} />}
            onClick={() => modals.openConfirmModal({ title: 'Remove the letterhead?', children: <Text size="sm">Letter reports go back to a plain page with page numbers.</Text>, labels: { confirm: 'Remove', cancel: 'Cancel' }, confirmProps: { color: 'red' }, onConfirm: () => void save(undefined) })}
          >
            Remove
          </Button>
        )}
      </Group>
      {lh && (
        <Stack gap="md">
          <Group align="flex-start" gap="lg" wrap="wrap">
            <PageSketch lh={lh} page={lh.first} label="First page" />
            <PageSketch lh={lh} page={lh.other} label="Other pages" />
            <Stack gap={6} style={{ flex: 1, minWidth: 240 }}>
              {lh.fileName && (
                <Text size="sm">
                  From <b>{lh.fileName}</b>
                </Text>
              )}
              <Text size="xs" c="dimmed">
                {[lh.font && `Text: ${lh.font}${lh.fontSize ? ` ${lh.fontSize} pt` : ''}`, lh.headingFont && `headings: ${lh.headingFont}`, `margins ${lh.marginsMm.top} / ${lh.marginsMm.right} / ${lh.marginsMm.bottom} / ${lh.marginsMm.left} mm`].filter(Boolean).join(' · ')}
              </Text>
              {lh.docx && (
                <Switch
                  size="xs"
                  label="Word downloads use the Word file’s own header and footers"
                  description="Exactly as in the file – changes below then show in PDFs and the preview only"
                  checked={lh.useWordFile !== false}
                  onChange={(e) => set({ useWordFile: e.currentTarget.checked })}
                />
              )}
              <Group gap="xs" align="center">
                {logos.slice(0, 1).map((l, i) => (
                  <img key={i} src={l.dataUrl} alt="Logo" style={{ height: 28, maxWidth: 140, objectFit: 'contain' }} />
                ))}
                <FileButton accept="image/png,image/jpeg" onChange={(f) => void setLogo(f)}>
                  {(p) => (
                    <Button {...p} size="compact-xs" variant="default" leftSection={<IconPhoto size={13} />}>
                      {logos.length ? 'Replace logo' : 'Add a logo'}
                    </Button>
                  )}
                </FileButton>
                {logos.length > 0 && (
                  <Button size="compact-xs" variant="subtle" color="red" onClick={() => void removeLogo()}>
                    Remove logo
                  </Button>
                )}
              </Group>
            </Stack>
          </Group>
          <MoreOptions label="Change the letterhead" summary="footers, colours, fonts and margins">
            <Stack gap="sm">
              <SimpleGrid cols={{ base: 1, sm: 2 }}>
                <Textarea label="First page footer" description="A line each, e.g. the company address" autosize minRows={2} maxRows={10} value={lines('first.footer')} onChange={(e) => setDraft({ ...draft, 'first.footer': e.currentTarget.value })} onBlur={() => commit('first.footer')} />
                <Textarea label="Other pages’ footer" description="{page} = the page number" autosize minRows={2} maxRows={10} value={lines('other.footer')} onChange={(e) => setDraft({ ...draft, 'other.footer': e.currentTarget.value })} onBlur={() => commit('other.footer')} />
              </SimpleGrid>
              <SimpleGrid cols={{ base: 2, sm: 4 }}>
                <ColorInput size="xs" label="Headings" value={lh.headingColor ?? ''} onChange={(v) => set({ headingColor: v || undefined })} placeholder="Template colour" />
                <ColorInput size="xs" label="Text" value={lh.textColor ?? ''} onChange={(v) => set({ textColor: v || undefined })} placeholder="Black" />
                <TextInput size="xs" label="Font (Word)" value={lh.font ?? ''} onChange={(e) => set({ font: e.currentTarget.value || undefined })} placeholder="Calibri" />
                <TextInput size="xs" label="Heading font (Word)" value={lh.headingFont ?? ''} onChange={(e) => set({ headingFont: e.currentTarget.value || undefined })} placeholder="As the text" />
              </SimpleGrid>
              <div>
                <Text size="sm" fw={500}>
                  Margins (mm)
                </Text>
                <Text size="xs" c="dimmed" mb={4}>
                  Header and footer: their distance from the edge of the page. Indent: how far text sits in from the left margin.
                </Text>
                <SimpleGrid cols={{ base: 3, sm: 7 }} spacing="xs">
                  {(['top', 'right', 'bottom', 'left', 'header', 'footer'] as const).map((k) => (
                    <NumberInput key={k} size="xs" label={k[0].toUpperCase() + k.slice(1)} min={0} max={80} step={0.5} value={lh.marginsMm[k]} onChange={(v) => set({ marginsMm: { ...lh.marginsMm, [k]: Number(v) || 0 } })} />
                  ))}
                  <NumberInput size="xs" label="Indent" min={0} max={30} step={0.5} value={lh.indentMm ?? 0} onChange={(v) => set({ indentMm: Number(v) || undefined })} />
                </SimpleGrid>
              </div>
              <Text size="xs" c="dimmed">
                PDFs are set in the app’s own font; Word documents use the fonts named here (installed on most company computers).
              </Text>
            </Stack>
          </MoreOptions>
        </Stack>
      )}
    </Card>
  );
}
