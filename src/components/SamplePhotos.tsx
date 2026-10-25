// A sample's photos: those the phone took in field mode and any added here. Thumbnails from the shared folder,
// a bigger view on click, Add photos from a computer, and × to take one off the sample (the file stays).

import { useEffect, useState } from 'react';
import { ActionIcon, Button, FileButton, Group, Image, Portal, Stack, Text, Tooltip } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { IconCamera, IconX } from '@tabler/icons-react';
import type { Project, Sample, Site } from '../db/types';
import { addSamplePhotos, photoName, photoUrl, removeSamplePhoto, samplePhotoPaths } from '../lib/photos';
import { useWorkspace } from '../sync/workspace';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/db';

function Thumb({ path, onOpen, onRemove }: { path: string; onOpen: (url: string) => void; onRemove: () => void }) {
  const [url, setUrl] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    let gone = false;
    let made: string | null = null;
    photoUrl(path).then((u) => {
      if (gone) {
        if (u) URL.revokeObjectURL(u);
        return;
      }
      made = u;
      setUrl(u);
    });
    return () => {
      gone = true;
      if (made) URL.revokeObjectURL(made);
    };
  }, [path]);
  return (
    <div style={{ position: 'relative', width: 96 }}>
      <Tooltip label={url === null ? `${photoName(path)} – not in the shared folder` : photoName(path)} withArrow>
        {url ? (
          <Image src={url} h={72} w={96} radius="sm" fit="cover" style={{ cursor: 'zoom-in' }} onClick={() => onOpen(url)} alt={photoName(path)} />
        ) : (
          <div style={{ height: 72, width: 96, borderRadius: 6, background: 'var(--mantine-color-default-hover)', display: 'grid', placeItems: 'center' }}>
            <Text size="xs" c="dimmed" ta="center" px={4} lineClamp={2}>
              {url === null ? 'Not found' : '…'}
            </Text>
          </div>
        )}
      </Tooltip>
      <ActionIcon size="xs" variant="filled" color="gray" aria-label={`Remove ${photoName(path)} from the sample`} onClick={onRemove} style={{ position: 'absolute', top: -6, right: -6 }}>
        <IconX size={10} />
      </ActionIcon>
    </div>
  );
}

/** The photo strip in a sample's details. */
export function SamplePhotos({ sample: given, site, project }: { sample: Sample; site: Pick<Site, 'code'> | undefined; project: Pick<Project, 'code' | 'name'> }) {
  const ws = useWorkspace();
  const live = useLiveQuery(() => db.samples.get(given.id), [given.id]);
  const sample = live ?? given;
  const paths = samplePhotoPaths(sample.notes);
  const [open, setOpen] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Escape closes the big view only – not the drawer it sits in (both listen on the window; this runs first)
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopImmediatePropagation();
      e.preventDefault();
      setOpen(null);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [open]);
  const connected = ws.phase === 'ready';
  const add = async (files: File[]) => {
    if (!files.length || !site) return;
    setBusy(true);
    try {
      const r = await addSamplePhotos(sample, site, project, files);
      if (r.error) notifications.show({ color: r.added ? 'orange' : 'red', message: r.error });
      if (r.added) notifications.show({ color: 'teal', message: `${r.added} photo${r.added === 1 ? '' : 's'} added – in the shared folder under Field photos.` });
    } finally {
      setBusy(false);
    }
  };
  if (!paths.length && !connected) return null;
  return (
    <Stack gap={6}>
      <Group justify="space-between">
        <Text fw={600} size="sm">
          Photos {paths.length ? `(${paths.length})` : ''}
        </Text>
        <FileButton onChange={add} accept="image/*" multiple disabled={!connected || !site}>
          {(props) => (
            <Button {...props} size="compact-xs" variant="subtle" leftSection={<IconCamera size={14} />} loading={busy}>
              Add photos
            </Button>
          )}
        </FileButton>
      </Group>
      {paths.length ? (
        <Group gap="sm">
          {paths.map((p) => (
            <Thumb key={p} path={p} onOpen={setOpen} onRemove={() => removeSamplePhoto(sample, p)} />
          ))}
        </Group>
      ) : (
        <Text size="xs" c="dimmed">
          None yet. Photos taken on the phone in field mode arrive here with the readings; add others from your computer.
        </Text>
      )}
      {open && (
        <Portal>
          {/* the big view: its own overlay (a Modal in a Drawer would close both on Escape) */}
          <div
            ref={(el) => el?.focus()}
            tabIndex={-1}
            role="dialog"
            aria-label="Photo"
            data-mantine-stop-propagation="true"
            onClick={() => setOpen(null)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                e.stopPropagation();
                setOpen(null);
              }
            }}
            style={{ position: 'fixed', inset: 0, zIndex: 1100, background: 'rgba(0,0,0,0.8)', display: 'grid', placeItems: 'center', cursor: 'zoom-out', outline: 'none' }}
          >
            <img src={open} alt="Photo" style={{ maxHeight: '92vh', maxWidth: '94vw', objectFit: 'contain', borderRadius: 6 }} />
          </div>
        </Portal>
      )}
    </Stack>
  );
}
