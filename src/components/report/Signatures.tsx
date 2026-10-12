import { useEffect, useState, type ClipboardEvent, type DragEvent } from 'react';
import { ActionIcon, Autocomplete, Box, Button, Card, FileButton, Group, Loader, NumberInput, Stack, Switch, Text, TextInput, Textarea, UnstyledButton } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { IconArrowDown, IconArrowUp, IconPhotoUp, IconPlus, IconTrash } from '@tabler/icons-react';
import type { Settings, Signatory, SignaturesBlock } from '../../db/types';
import { saveSettings } from '../../db/db';
import { useSettings } from '../../hooks/useSettings';
import { uid } from '../../lib/ids';
import { fetchedImage, trimmedImage, trimmedImageFile } from '../../lib/image';
import { SIGN_ROLES, parseSignaturePaste, type PastedPerson } from '../../lib/signaturePaste';
import { DEFAULT_SIGNATURE_MM } from '../../reports/build';

// Report sign-off: people with their signatures. A signature can be pasted (an image, or a whole signature copied
// from an email or a Word document), dropped or uploaded.

interface Transfer {
  html: string;
  text: string;
  rtf: string;
  files: File[];
}

/** What a paste or drop holds; read straight away, as the browser empties it after the event. */
const transferOf = (dt: DataTransfer): Transfer => ({
  html: dt.getData('text/html'),
  text: dt.getData('text/plain'),
  rtf: dt.getData('text/rtf'),
  files: Array.from(dt.files ?? []).filter((f) => f.type.startsWith('image/')),
});

interface ReadSignature {
  people: PastedPerson[];
  /** The images, trimmed, or null where one couldn't be read. */
  images: Array<string | null>;
}

async function readTransfer(t: Transfer): Promise<ReadSignature> {
  const parsed = parseSignaturePaste(t);
  const hasText = parsed.people.some((p) => p.name || p.role || p.date || p.details.length);
  // an image on its own (a copied picture or screenshot); with text, a file is often a picture of the whole selection
  if (!hasText && t.files.length) return { people: [{ details: [], images: [0] }], images: [await trimmedImageFile(t.files[0])] };
  const images = await Promise.all(parsed.images.map((src) => (!src ? null : src.startsWith('data:') ? trimmedImage(src) : fetchedImage(src))));
  return { people: parsed.people, images };
}

const imagesOf = (r: ReadSignature, p: PastedPerson) => p.images.map((i) => r.images[i]).filter((x): x is string => !!x);

/** Read a paste or drop and report what was found; `onPeople` gets everyone in it with their images. */
function useSignatureReader(onPeople: (people: Array<{ person: PastedPerson; images: string[] }>) => void) {
  const [busy, setBusy] = useState(false);
  const read = async (t: Transfer) => {
    setBusy(true);
    try {
      const r = await readTransfer(t);
      if (!r.people.length) {
        notifications.show({ color: 'orange', message: 'There was no signature or text to use in what you pasted.' });
        return;
      }
      onPeople(r.people.map((person) => ({ person, images: imagesOf(r, person) })));
      const lost = r.people.some((p) => p.images.length && !imagesOf(r, p).length);
      if (lost)
        notifications.show({
          color: 'orange',
          autoClose: 12000,
          title: 'The signature image could not be read',
          message: 'Some apps copy pictures as links the browser can’t open. Copy just the signature image (right-click › Copy) and paste it into the box, or use Upload image.',
        });
      else if (r.people.length > 1) notifications.show({ color: 'teal', message: `Added ${r.people.length} people from the sign-off you pasted.` });
    } finally {
      setBusy(false);
    }
  };
  return {
    busy,
    onPaste: (e: ClipboardEvent) => {
      e.preventDefault();
      void read(transferOf(e.clipboardData));
    },
    onDrop: (e: DragEvent) => {
      e.preventDefault();
      if ((e.currentTarget as HTMLElement).closest('fieldset:disabled')) return; // a built-in template, read only
      void read(transferOf(e.dataTransfer));
    },
    onFile: async (file: File | null) => {
      if (!file) return;
      setBusy(true);
      const image = await trimmedImageFile(file).finally(() => setBusy(false));
      if (image) onPeople([{ person: { details: [], images: [0] }, images: [image] }]);
      else notifications.show({ color: 'red', message: 'That file could not be read as an image.' });
    },
  };
}

/** A signature image with a box to paste into, drop on or upload to. */
export function SignatureInput({ image, name, onImage, onPeople }: { image?: string; name?: string; onImage: (image: string | undefined) => void; onPeople: (people: Array<{ person: PastedPerson; images: string[] }>) => void }) {
  const [others, setOthers] = useState<string[]>([]); // other images in the last paste, e.g. a logo
  const reader = useSignatureReader((people) => {
    setOthers(people[0].images.slice(1));
    onPeople(people);
  });
  const [focused, setFocused] = useState(false);
  return (
    <Stack gap={6} onDragOver={(e) => e.preventDefault()} onDrop={reader.onDrop}>
      {/* the box is a paste target: a see-through text box over the signature, so clicking it and pasting works (and a phone offers Paste) */}
      <Box
        pos="relative"
        style={{
          height: 76,
          border: `1px ${focused ? 'solid' : 'dashed'} var(--mantine-color-${focused ? 'teal-6' : 'gray-5'})`,
          boxShadow: focused ? '0 0 0 2px var(--mantine-color-teal-1)' : undefined,
          borderRadius: 6,
          background: '#fff',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          overflow: 'hidden',
          padding: 6,
        }}
      >
        {reader.busy ? (
          <Loader size="sm" />
        ) : image ? (
          <img src={image} alt={`Signature${name ? ` of ${name}` : ''}`} style={{ maxWidth: '100%', maxHeight: '100%' }} />
        ) : (
          <Text size="xs" c={focused ? 'teal.8' : 'dimmed'} ta="center" lh={1.35}>
            {focused ? 'Now paste (Ctrl+V)' : 'Click here and paste (Ctrl+V) a signature image, or a whole signature copied from an email or Word'}
          </Text>
        )}
        <textarea
          aria-label="Paste a signature"
          value=""
          onChange={() => {}}
          onPaste={reader.onPaste}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', opacity: 0, cursor: 'pointer', resize: 'none', border: 0 }}
        />
      </Box>
      {image && (
        <Text size="xs" c={focused ? 'teal.8' : 'dimmed'} mt={-2}>
          {focused ? 'Now paste (Ctrl+V) to replace it.' : 'Click the signature and paste (Ctrl+V) to replace it.'} Without a signature, a line is left to sign by hand.
        </Text>
      )}
      <Group gap="xs">
        <FileButton onChange={reader.onFile} accept="image/png,image/jpeg,image/gif,image/webp,image/bmp">
          {(props) => (
            <Button {...props} size="compact-xs" variant="light" leftSection={<IconPhotoUp size={13} />}>
              Upload image
            </Button>
          )}
        </FileButton>
        {image && (
          <Button size="compact-xs" variant="subtle" color="red" onClick={() => onImage(undefined)}>
            Remove image
          </Button>
        )}
        {others.length > 0 && (
          <Group gap={4} wrap="nowrap">
            <Text size="xs" c="dimmed">
              Use another image instead:
            </Text>
            {others.map((o, i) => (
              <UnstyledButton key={i} onClick={() => (onImage(o), setOthers(others.filter((x) => x !== o).concat(image ? [image] : [])))} aria-label={`Use pasted image ${i + 2}`} style={{ border: '1px solid var(--mantine-color-gray-4)', borderRadius: 4, padding: 2, background: '#fff', lineHeight: 0 }}>
                <img src={o} alt="" style={{ height: 24, maxWidth: 80 }} />
              </UnstyledButton>
            ))}
          </Group>
        )}
      </Group>
    </Stack>
  );
}

/** A text field saved when it loses focus (for values kept in Settings). */
function useDraft(value: string, save: (v: string) => void) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  return { value: draft, onChange: (e: { currentTarget: { value: string } }) => setDraft(e.currentTarget.value), onBlur: () => draft !== value && save(draft) };
}

/** The lines under your name: as set, or the company until you set them. */
export const myDetails = (s: Settings) => s.signatureDetails ?? s.company;

function SignatoryCard({
  s,
  index,
  count,
  settings,
  onChange,
  onRemove,
  onMove,
}: {
  s: Signatory;
  index: number;
  count: number;
  settings: Settings;
  /** This person changed; `more` people (from a pasted sign-off table) go after them. */
  onChange: (s: Signatory, more?: Signatory[]) => void;
  onRemove: () => void;
  onMove: (d: -1 | 1) => void;
}) {
  const me = !!s.self;
  const myName = useDraft(settings.author, (author) => saveSettings({ author }));
  const myLines = useDraft(myDetails(settings), (signatureDetails) => saveSettings({ signatureDetails }));
  const image = me ? settings.signatureImage : s.image;
  const setImage = (img: string | undefined) => (me ? void saveSettings({ signatureImage: img }) : onChange({ ...s, image: img }));
  const onPeople = (people: Array<{ person: PastedPerson; images: string[] }>) => {
    const [{ person, images }, ...rest] = people;
    const filled = { name: person.name, details: person.name || person.details.length ? person.details.join('\n') : undefined, image: images[0] };
    const next: Signatory = { ...s, role: person.role ?? s.role, date: person.date ?? s.date };
    const more = rest.map(({ person: p, images: im }): Signatory => ({ id: uid('sg'), role: p.role ?? '', name: p.name ?? '', details: p.details.join('\n'), image: im[0], date: p.date }));
    if (me) {
      const patch: Partial<Settings> = {};
      if (filled.name) patch.author = filled.name;
      if (filled.details !== undefined) patch.signatureDetails = filled.details;
      if (filled.image) patch.signatureImage = filled.image;
      void saveSettings(patch);
      onChange(next, more);
    } else onChange({ ...next, ...(filled.name ? { name: filled.name } : {}), ...(filled.details !== undefined ? { details: filled.details } : {}), ...(filled.image ? { image: filled.image } : {}) }, more);
  };
  const toggleMe = (on: boolean) => {
    if (on) {
      // keep what was entered here as your signature when Settings don't have one yet
      const patch: Partial<Settings> = {};
      if (!settings.author && s.name) patch.author = s.name;
      if (settings.signatureDetails === undefined && s.details) patch.signatureDetails = s.details;
      if (!settings.signatureImage && s.image) patch.signatureImage = s.image;
      if (Object.keys(patch).length) void saveSettings(patch);
    }
    onChange({ ...s, self: on || undefined });
  };
  const name = me ? settings.author : s.name;
  return (
    <Card withBorder padding="xs">
      <Stack gap={6}>
        <Group justify="space-between" wrap="nowrap" gap="xs">
          <Switch size="xs" label="Me – my name and signature from Settings" checked={me} onChange={(e) => toggleMe(e.currentTarget.checked)} />
          <Group gap={0} wrap="nowrap">
            <ActionIcon size="sm" variant="subtle" disabled={index === 0} onClick={() => onMove(-1)} aria-label={`Move ${s.role || 'person'} up`}>
              <IconArrowUp size={14} />
            </ActionIcon>
            <ActionIcon size="sm" variant="subtle" disabled={index === count - 1} onClick={() => onMove(1)} aria-label={`Move ${s.role || 'person'} down`}>
              <IconArrowDown size={14} />
            </ActionIcon>
            <ActionIcon size="sm" variant="subtle" color="red" onClick={onRemove} aria-label={`Remove ${s.role || 'person'}`}>
              <IconTrash size={14} />
            </ActionIcon>
          </Group>
        </Group>
        <Autocomplete size="xs" label="Role" data={SIGN_ROLES} value={s.role} onChange={(role) => onChange({ ...s, role })} />
        {me && (
          <Text size="xs" c="dimmed">
            Your name, the lines under it and your signature are kept in Settings, so they are the same in every report you sign.
          </Text>
        )}
        <SignatureInput image={image} name={name} onImage={setImage} onPeople={onPeople} />
        {me ? (
          <>
            <TextInput size="xs" label="Name" {...myName} />
            <Textarea size="xs" label="Lines under the name" description="One per line, e.g. job title, qualifications, company" autosize minRows={2} maxRows={6} {...myLines} />
          </>
        ) : (
          <>
            <TextInput size="xs" label="Name" value={s.name} onChange={(e) => onChange({ ...s, name: e.currentTarget.value })} />
            <Textarea size="xs" label="Lines under the name" description="One per line, e.g. job title, qualifications, company" autosize minRows={2} maxRows={6} value={s.details} onChange={(e) => onChange({ ...s, details: e.currentTarget.value })} />
          </>
        )}
        <TextInput size="xs" label="Date" placeholder="Blank for none, or e.g. {{today}}" value={s.date ?? ''} onChange={(e) => onChange({ ...s, date: e.currentTarget.value || undefined })} />
      </Stack>
    </Card>
  );
}

export const newSignatory = (taken: Signatory[]): Signatory => ({ id: uid('sg'), role: SIGN_ROLES.find((r) => !taken.some((s) => s.role === r)) ?? '', name: '', details: '' });

export function SignaturesForm({ block, onChange }: { block: SignaturesBlock; onChange: (b: SignaturesBlock) => void }) {
  const settings = useSettings();
  const list = block.signatories;
  const set = (signatories: Signatory[]) => onChange({ ...block, signatories });
  return (
    <Stack gap="xs">
      <Text size="xs" c="dimmed">
        Paste a signature copied from an email or a Word document into a person’s box: the image, name and the lines under it are filled in, and a sign-off table with several people adds them all. You can also drop or upload an image. People without a name are left out.
      </Text>
      {list.map((s, i) => (
        <SignatoryCard
          key={s.id}
          s={s}
          index={i}
          count={list.length}
          settings={settings}
          onChange={(x, more = []) => set([...list.slice(0, i), x, ...more, ...list.slice(i + 1)])}
          onRemove={() => set(list.filter((y) => y.id !== s.id))}
          onMove={(d) => {
            const next = [...list];
            [next[i], next[i + d]] = [next[i + d], next[i]];
            set(next);
          }}
        />
      ))}
      <Group justify="space-between" align="flex-end">
        <Button size="xs" variant="light" leftSection={<IconPlus size={14} />} onClick={() => set([...list, newSignatory(list)])}>
          Add a person
        </Button>
        <NumberInput size="xs" label="Signature height (mm)" w={150} min={8} max={40} value={block.imageHeightMm ?? DEFAULT_SIGNATURE_MM} onChange={(v) => onChange({ ...block, imageHeightMm: Number(v) || undefined })} />
      </Group>
    </Stack>
  );
}
