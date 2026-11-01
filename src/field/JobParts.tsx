// Field mode's quick jobs and photos: starting a job on the phone (no computer needed first), the photos at a site or
// point – full size, each with where it was taken – and naming a point or adding a reading on the spot.

import { useEffect, useMemo, useState } from 'react';
import { ActionIcon, Badge, Button, Chip, FileButton, Group, Image, Modal, Select, SimpleGrid, Stack, Text, TextInput, Textarea, UnstyledButton } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { useLiveQuery } from 'dexie-react-hooks';
import { useNavigate } from 'react-router-dom';
import { IconCamera, IconCurrentLocation, IconMapPin, IconPhoto, IconTrash } from '@tabler/icons-react';
import { addMeasure, addPhoto, fieldDb, getPref, knownProjects, newJob, removePhoto, setPhotoGps, updateSite, type StoredPhoto } from './db';
import { currentPosition, recentFix, useMyPosition } from './FieldMap';
import type { FieldMeasure, FieldSheet, FieldSite } from './model';
import { SITE_TYPES } from '../db/types';
import { BUILT_IN_PARAMETERS } from '../data/parameters';
import { unitLabel } from '../lib/units';
import { readPhotoInfo } from '../lib/exif';

// ------------------------------------------------------------ readings

/** The readings a phone can take: the built-in field parameters (pH, temperature …), as measures. */
export const FIELD_MEASURES: FieldMeasure[] = BUILT_IN_PARAMETERS.filter((p) => p.group === 'Field').map((p) => ({ id: p.id, name: p.name, unit: unitLabel(p.unit), ...(p.decimals !== undefined ? { dp: p.decimals } : {}) }));
/** The ones offered first. */
const COMMON = ['ph-field', 'temp', 'ec-field', 'do', 'turbidity-field', 'swl'];
const short = (m: FieldMeasure) => m.name.replace(/\s*\(field\)/i, '').replace('Electrical Conductivity', 'Conductivity').replace('Static Water Level', 'Water level (SWL)');

/** Adding a reading the sheet doesn't ask for (it goes to the computer like the others). */
export function AddReading({ sheet }: { sheet: FieldSheet }) {
  const [open, setOpen] = useState(false);
  const left = FIELD_MEASURES.filter((m) => !sheet.measures.some((x) => x.id === m.id));
  if (!left.length) return null;
  return open ? (
    <Select
      size="md"
      label="Add a reading"
      placeholder="Choose one"
      data={left.map((m) => ({ value: m.id, label: `${short(m)}${m.unit ? ` · ${m.unit}` : ''}` }))}
      searchable
      dropdownOpened
      onDropdownClose={() => setOpen(false)}
      onChange={(id) => {
        const m = left.find((x) => x.id === id);
        if (m) void addMeasure(sheet.id, m);
        setOpen(false);
      }}
    />
  ) : (
    <Button variant="subtle" size="xs" onClick={() => setOpen(true)} style={{ alignSelf: 'flex-start' }}>
      + Add a reading
    </Button>
  );
}

// ------------------------------------------------------------ a new job

/** Starting a job on the phone: what it is, the project if known, the readings to take. Photos and notes always. */
export function NewJobModal({ opened, onClose }: { opened: boolean; onClose: () => void }) {
  const navigate = useNavigate();
  const projects = useLiveQuery(() => knownProjects(), []) ?? [];
  const [name, setName] = useState('');
  const [projectId, setProjectId] = useState('');
  const [picked, setPicked] = useState<string[]>([]);
  useEffect(() => {
    if (!opened) return;
    setName('');
    setPicked([]);
    setProjectId('');
  }, [opened]);
  const start = async () => {
    const project = projects.find((p) => p.project.id === projectId)?.project ?? null;
    const measures = picked.map((id) => FIELD_MEASURES.find((m) => m.id === id)!).filter(Boolean);
    const sheet = await newJob(name, project, measures, await getPref('name'));
    onClose();
    navigate(`/field/s/${encodeURIComponent(sheet.id)}`);
  };
  return (
    <Modal opened={opened} onClose={onClose} title="New job" centered>
      <Stack gap="sm">
        <TextInput size="md" label="What’s the job?" placeholder="e.g. Culvert inspection, Smith Road" value={name} onChange={(e) => setName(e.currentTarget.value)} data-autofocus />
        <Select
          size="md"
          label="Project"
          data={[{ value: '', label: 'Choose on the computer' }, ...projects.map((p) => ({ value: p.project.id, label: p.project.code ? `${p.project.name} (${p.project.code})` : p.project.name }))]}
          value={projectId}
          onChange={(v) => setProjectId(v ?? '')}
          allowDeselect={false}
          description={projects.length ? undefined : 'Projects show here once this phone has opened one of their sheets or codes.'}
        />
        <div>
          <Text size="sm" fw={500} mb={6}>
            Readings to take <Text span size="xs" c="dimmed">(optional – photos and notes are always there)</Text>
          </Text>
          <Chip.Group multiple value={picked} onChange={setPicked}>
            <Group gap={6}>
              {COMMON.map((id) => FIELD_MEASURES.find((m) => m.id === id)).filter((m): m is FieldMeasure => !!m).map((m) => (
                <Chip key={m.id} value={m.id} size="sm">
                  {short(m)}
                </Chip>
              ))}
            </Group>
          </Chip.Group>
        </div>
        <Button size="md" onClick={() => void start()} disabled={!name.trim()}>
          Start the job
        </Button>
      </Stack>
    </Modal>
  );
}

// ------------------------------------------------------------ naming a point

/** A point added on the phone: its code, name, kind and notes (a sheet's own sites are the computer's to change). */
export function EditPointModal({ opened, sheet, site, onClose }: { opened: boolean; sheet: FieldSheet; site: FieldSite; onClose: () => void }) {
  const [code, setCode] = useState(site.code);
  const [name, setName] = useState(site.name ?? '');
  const [type, setType] = useState(site.type ?? 'Other');
  const [note, setNote] = useState(site.note ?? '');
  useEffect(() => {
    if (!opened) return;
    setCode(site.code);
    setName(site.name ?? '');
    setType(site.type ?? 'Other');
    setNote(site.note ?? '');
  }, [opened]);
  const taken = sheet.sites.some((s) => s.id !== site.id && s.code.trim().toLowerCase() === code.trim().toLowerCase());
  const save = async () => {
    const renamed = code.trim() !== site.code;
    await updateSite(sheet.id, site.id, { code: code.trim(), name: name.trim() || undefined, type, note: note.trim() || undefined, ...(renamed ? { auto: false } : {}) });
    onClose();
  };
  return (
    <Modal opened={opened} onClose={onClose} title="This point" centered>
      <Stack gap="sm">
        <TextInput size="md" label="Code" description="A site’s code if it’s one of the project’s sites (EnviroDB adds to that site), or a new one" value={code} onChange={(e) => setCode(e.currentTarget.value)} error={taken ? 'Another point has this code' : undefined} />
        <TextInput size="md" label="Name" placeholder="e.g. Culvert outlet" value={name} onChange={(e) => setName(e.currentTarget.value)} />
        <Select size="md" label="Kind" data={SITE_TYPES.filter((t) => t !== 'Quality control')} value={type} onChange={(x) => x && setType(x)} allowDeselect={false} />
        <Textarea size="md" label="Directions and notes" autosize minRows={2} value={note} onChange={(e) => setNote(e.currentTarget.value)} />
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={!code.trim() || taken} onClick={() => void save()}>
            Save
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}

// ------------------------------------------------------------ photos

const KEEP = /^image\/(jpeg|png|webp)$/;

/** A photo as the camera took it – or, in a format other browsers can't show (HEIC), as a full-size JPEG. */
async function keepPhoto(f: File): Promise<Blob> {
  if (KEEP.test(f.type)) return f;
  const url = URL.createObjectURL(f);
  try {
    const img = new window.Image();
    img.src = url;
    await img.decode();
    const c = document.createElement('canvas');
    c.width = img.naturalWidth;
    c.height = img.naturalHeight;
    c.getContext('2d')!.drawImage(img, 0, 0);
    const out = await new Promise<Blob | null>((r) => c.toBlob(r, 'image/jpeg', 0.92));
    if (!out) throw new Error();
    return out;
  } catch {
    throw new Error(`“${f.name}” can’t be read here – set the camera to take JPEG photos (Most Compatible).`);
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** A small copy to show: 360 px across. */
async function thumbOf(blob: Blob): Promise<string> {
  const url = URL.createObjectURL(blob);
  try {
    const img = new window.Image();
    img.src = url;
    await img.decode();
    const k = Math.min(1, 360 / Math.max(img.naturalWidth, img.naturalHeight));
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(img.naturalWidth * k));
    c.height = Math.max(1, Math.round(img.naturalHeight * k));
    c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height);
    return c.toDataURL('image/jpeg', 0.75);
  } finally {
    URL.revokeObjectURL(url);
  }
}

const sizeText = (n: number) => (n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`);
const timeOf = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
};
let persisted = false;

/** One photo, big: when and where, and taking it off. */
function PhotoViewer({ photo, onClose }: { photo: StoredPhoto | null; onClose: () => void }) {
  // the picture of the photo shown (never the one before's, let go of already)
  const [shown, setShown] = useState<{ id: string; url: string } | null>(null);
  useEffect(() => {
    if (!photo) return;
    const u = URL.createObjectURL(photo.blob);
    setShown({ id: photo.id, url: u });
    return () => URL.revokeObjectURL(u);
  }, [photo]);
  const url = shown && photo && shown.id === photo.id ? shown.url : null;
  return (
    <Modal opened={!!photo} onClose={onClose} size="xl" centered title={photo ? timeOf(photo.at) : ''}>
      {photo && (
        <Stack gap="xs">
          {url && <Image src={url} alt="Photo" radius="sm" mah="65vh" fit="contain" />}
          <Text size="sm" c="dimmed">
            {photo.gps ? `${photo.gps.lat.toFixed(6)}, ${photo.gps.lng.toFixed(6)}${photo.gps.acc ? ` (±${photo.gps.acc} m)` : ''} · ${photo.gpsFrom === 'camera' ? 'the camera’s location' : 'by this phone’s GPS'}` : 'No location'} · {sizeText(photo.size)}
          </Text>
          <Group justify="space-between">
            <Button
              variant="subtle"
              color="red"
              leftSection={<IconTrash size={16} />}
              onClick={() => {
                void removePhoto(photo.id);
                onClose();
              }}
            >
              Delete this photo
            </Button>
            <Button variant="default" onClick={onClose}>
              Close
            </Button>
          </Group>
        </Stack>
      )}
    </Modal>
  );
}

/**
 * The photos at a site or point: taken with the camera at full size, each with where it was taken (the phone's
 * GPS, followed while this is on screen) – or added from the gallery, with the camera's own location if it kept one.
 */
export function PhotoSection({ sheetId, site, onAdded }: { sheetId: string; site: FieldSite; onAdded: () => void }) {
  const photos = useLiveQuery(() => fieldDb.photos.where('[sheetId+siteId]').equals([sheetId, site.id]).sortBy('at'), [sheetId, site.id]);
  const { me, error } = useMyPosition(true);
  const [busy, setBusy] = useState(0);
  const [open, setOpen] = useState<StoredPhoto | null>(null);
  const add = async (files: File[], from: 'camera' | 'gallery') => {
    if (!files.length) return;
    setBusy((n) => n + files.length);
    if (!persisted) {
      persisted = true;
      void navigator.storage?.persist?.().catch(() => undefined);
    }
    for (const f of files) {
      try {
        const blob = await keepPhoto(f);
        const info = blob.type === 'image/jpeg' ? readPhotoInfo(new Uint8Array(await blob.slice(0, 256 * 1024).arrayBuffer())) : {};
        // the camera's location when it kept one; else, for a photo taken now, this phone's
        let gps: StoredPhoto['gps'] = info.gps;
        let gpsFrom: StoredPhoto['gpsFrom'] = info.gps ? 'camera' : undefined;
        const fix = from === 'camera' && !gps ? recentFix(60000) : null;
        if (fix) [gps, gpsFrom] = [fix, 'phone'];
        const taken = from === 'gallery' ? (info.taken ? new Date(info.taken) : new Date(f.lastModified || Date.now())) : new Date();
        const id = await addPhoto({ sheetId, siteId: site.id, blob, type: blob.type, size: blob.size, thumb: await thumbOf(blob), at: (Number.isNaN(taken.getTime()) ? new Date() : taken).toISOString(), ...(gps ? { gps, gpsFrom } : {}) });
        // no fix yet: the location follows when the phone has it
        if (from === 'camera' && !gps) void currentPosition().then((p) => setPhotoGps(id, p, 'phone')).catch(() => undefined);
        onAdded();
      } catch (e) {
        notifications.show({ color: 'red', message: (e as Error).message });
      } finally {
        setBusy((n) => n - 1);
      }
    }
  };
  const located = (photos ?? []).filter((p) => p.gps).length;
  return (
    <Stack gap={6}>
      <Group gap="xs" wrap="nowrap">
        <FileButton accept="image/*" capture="environment" onChange={(f) => void add(f ? [f] : [], 'camera')}>
          {(props) => (
            <Button {...props} size="md" variant="light" leftSection={<IconCamera size={18} />} loading={busy > 0} style={{ flex: 1 }}>
              Take a photo
            </Button>
          )}
        </FileButton>
        <FileButton accept="image/*" multiple onChange={(f) => void add(f ?? [], 'gallery')}>
          {(props) => (
            <Button {...props} size="md" variant="default" aria-label="Add photos from the gallery" px="sm">
              <IconPhoto size={18} />
            </Button>
          )}
        </FileButton>
      </Group>
      <Text size="xs" c={error ? 'orange' : 'dimmed'}>
        <IconCurrentLocation size={12} style={{ verticalAlign: -1 }} /> {error ? `${error} Photos are kept without a location.` : me ? `Photos are located to ±${me.acc ?? '?'} m.` : 'Finding the location for photos…'} Full size, as the camera takes them.
      </Text>
      {!!photos?.length && (
        <>
          <SimpleGrid cols={3} spacing={6}>
            {photos.map((p) => (
              <UnstyledButton key={p.id} onClick={() => setOpen(p)} aria-label={`Photo, ${timeOf(p.at)}${p.gps ? ', located' : ''}`} style={{ position: 'relative' }}>
                <img src={p.thumb} alt="" style={{ width: '100%', aspectRatio: '1', objectFit: 'cover', borderRadius: 6, display: 'block' }} />
                {p.gps && (
                  <ActionIcon component="span" size="xs" radius="xl" variant="filled" color="teal" style={{ position: 'absolute', left: 4, bottom: 4, pointerEvents: 'none' }} aria-hidden>
                    <IconMapPin size={10} />
                  </ActionIcon>
                )}
              </UnstyledButton>
            ))}
          </SimpleGrid>
          <Text size="xs" c="dimmed">
            {photos.length} photo{photos.length === 1 ? '' : 's'} · {sizeText(photos.reduce((n, p) => n + p.size, 0))}
            {located < photos.length ? ` · ${photos.length - located} without a location` : ''}
          </Text>
        </>
      )}
      <PhotoViewer photo={open} onClose={() => setOpen(null)} />
    </Stack>
  );
}

/** How many photos each sheet (or each site of one) has. */
export function usePhotoCounts(sheetId?: string): Map<string, { n: number; size: number }> {
  const photos = useLiveQuery(() => (sheetId ? fieldDb.photos.where('sheetId').equals(sheetId).toArray() : fieldDb.photos.toArray()), [sheetId]);
  return useMemo(() => {
    const m = new Map<string, { n: number; size: number }>();
    for (const p of photos ?? []) {
      const k = sheetId ? p.siteId : p.sheetId;
      const cur = m.get(k) ?? { n: 0, size: 0 };
      m.set(k, { n: cur.n + 1, size: cur.size + p.size });
    }
    return m;
  }, [photos, sheetId]);
}

export const photoSizeText = sizeText;

/** A badge for a site's or a job's photos. */
export function PhotoBadge({ n }: { n: number }) {
  return n ? (
    <Badge variant="light" color="gray" leftSection={<IconCamera size={11} />}>
      {n}
    </Badge>
  ) : null;
}
