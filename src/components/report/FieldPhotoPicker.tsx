// Photos for a report's figures from the project's field photos – those the phone took in field mode and any added
// to samples since – kept in the team's shared folder. The report's period and sites first; every photo the project
// has is a click away. Chosen photos are scaled like an image dropped on the box and captioned with the site and day.

import { useEffect, useMemo, useState } from 'react';
import { Alert, Anchor, Badge, Button, Checkbox, Group, Modal, ScrollArea, SegmentedControl, SimpleGrid, Stack, Text, UnstyledButton } from '@mantine/core';
import { useIntersection } from '@mantine/hooks';
import { notifications } from '@mantine/notifications';
import { IconCamera } from '@tabler/icons-react';
import type { FigureImage, Sample, Site } from '../../db/types';
import { photoAsFigure, photoCaption, photoName, photosFor, projectPhotos, type FieldPhoto } from '../../lib/photos';
import { formatDate, formatDateLong } from '../../lib/dates';
import { usePhotoUrl } from '../../hooks/usePhotoUrl';

const day = (p: FieldPhoto) => p.date.slice(0, 10);

function PhotoTile({ photo, site, chosen, added, onToggle }: { photo: FieldPhoto; site: Site | undefined; chosen: boolean; added: boolean; onToggle: () => void }) {
  // loaded when it comes into view: a project can have hundreds
  const { ref, entry } = useIntersection<HTMLButtonElement>({ threshold: 0 });
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    if (entry?.isIntersecting) setSeen(true);
  }, [entry?.isIntersecting]);
  const url = usePhotoUrl(photo.path, seen);
  const label = `${site?.code ?? 'Site'} ${formatDate(day(photo))} – ${photoName(photo.path)}`;
  return (
    <UnstyledButton
      ref={ref}
      role="checkbox"
      aria-checked={chosen}
      aria-disabled={added}
      aria-label={added ? `${label} (already in this report)` : label}
      onClick={() => !added && onToggle()}
      style={{
        position: 'relative',
        borderRadius: 8,
        padding: 3,
        border: `2px solid ${chosen ? 'var(--mantine-primary-color-filled)' : 'transparent'}`,
        background: chosen ? 'var(--mantine-primary-color-light)' : undefined,
        opacity: added ? 0.5 : 1,
        cursor: added ? 'default' : 'pointer',
      }}
    >
      <div style={{ aspectRatio: '4 / 3', borderRadius: 6, overflow: 'hidden', background: 'var(--mantine-color-default-hover)', display: 'grid', placeItems: 'center' }}>
        {url ? (
          <img src={url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
        ) : (
          <Text size="xs" c="dimmed" px={4} ta="center">
            {url === null ? 'Not in the shared folder' : '…'}
          </Text>
        )}
      </div>
      <Group gap={4} mt={4} wrap="nowrap" justify="space-between">
        <Text size="xs" fw={600} truncate>
          {site?.code ?? '?'}
          {site?.name ? (
            <Text span size="xs" c="dimmed" fw={400}>
              {' '}
              {site.name}
            </Text>
          ) : null}
        </Text>
        {added && (
          <Badge size="xs" variant="light" color="gray" style={{ flexShrink: 0 }}>
            Added
          </Badge>
        )}
      </Group>
      {!added && <Checkbox checked={chosen} readOnly tabIndex={-1} size="xs" aria-hidden style={{ position: 'absolute', top: 8, left: 8, pointerEvents: 'none' }} />}
    </UnstyledButton>
  );
}

export function FieldPhotoPicker({ samples, sites, period, siteIds, images, onAdd }: {
  samples: Sample[];
  sites: Site[];
  period: { start: string; end: string; label?: string };
  /** The sites the report covers (none: every site). */
  siteIds?: string[] | null;
  /** The figures already in the section: their photos show as added. */
  images: FigureImage[];
  onAdd: (images: FigureImage[]) => void;
}) {
  const siteMap = useMemo(() => new Map(sites.map((s) => [s.id, s])), [sites]);
  const order = useMemo(() => new Map(sites.map((s, i) => [s.id, i])), [sites]);
  const all = useMemo(() => projectPhotos(samples, order), [samples, order]);
  const inReport = useMemo(() => photosFor(all, period, siteIds), [all, period, siteIds]);
  const added = useMemo(() => new Set(images.map((im) => im.from).filter((p): p is string => !!p)), [images]);
  const [open, setOpen] = useState(false);
  const [scope, setScope] = useState<'report' | 'all'>('report');
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  if (!all.length) return null;

  const shown = scope === 'report' ? inReport : all;
  const days: Array<{ day: string; photos: FieldPhoto[] }> = [];
  for (const p of shown) {
    const last = days[days.length - 1];
    if (last?.day === day(p)) last.photos.push(p);
    else days.push({ day: day(p), photos: [p] });
  }
  const toggle = (path: string) =>
    setChosen((cur) => {
      const next = new Set(cur);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  const start = () => {
    setScope(inReport.length ? 'report' : 'all');
    setChosen(new Set());
    setOpen(true);
  };
  const add = async () => {
    // in the report's order: day by day, the sites in their order, as taken
    const index = new Map(all.map((p, i) => [p.path, i]));
    const list = all.filter((p) => chosen.has(p.path)).sort((a, b) => (day(a) !== day(b) ? (day(a) < day(b) ? -1 : 1) : index.get(a.path)! - index.get(b.path)!));
    setBusy(true);
    const out: FigureImage[] = [];
    const failed: string[] = [];
    for (const p of list) {
      try {
        out.push(await photoAsFigure(p, photoCaption(siteMap.get(p.siteId), p.date)));
      } catch (e) {
        failed.push((e as Error).message);
      }
    }
    setBusy(false);
    if (out.length) {
      onAdd(out);
      notifications.show({ color: 'teal', message: `${out.length} photo${out.length === 1 ? '' : 's'} added. Each caption gives the site and day – change them as you like.` });
    }
    if (failed.length) notifications.show({ color: 'orange', title: `${failed.length} photo${failed.length === 1 ? '' : 's'} couldn’t be added`, message: failed.slice(0, 3).join(' ') });
    if (!failed.length) setOpen(false);
  };
  const where = siteIds?.length ? ' at the report’s sites' : '';
  return (
    <>
      <Group gap={6} justify="center" wrap="wrap">
        <Button variant="subtle" size="compact-sm" leftSection={<IconCamera size={15} />} onClick={start}>
          Choose from field photos
        </Button>
        <Text size="xs" c="dimmed">
          {inReport.length ? `${inReport.length} in this report’s period${where}` : 'none in this report’s period'}
          {all.length > inReport.length ? ` · ${all.length} in all` : ''}
        </Text>
      </Group>
      <Modal opened={open} onClose={() => !busy && setOpen(false)} title="Field photos" size="xl">
        <Stack gap="sm">
          <Group justify="space-between" wrap="wrap" gap="xs">
            <SegmentedControl
              size="xs"
              value={scope}
              onChange={(v) => setScope(v as 'report' | 'all')}
              data={[
                { value: 'report', label: `This report (${inReport.length})` },
                { value: 'all', label: `All the project’s (${all.length})` },
              ]}
            />
            <Text size="xs" c="dimmed">
              {scope === 'report' ? `${period.label ?? `${formatDate(period.start)} – ${formatDate(period.end)}`}${where}` : 'Every photo kept with the project’s samples'}
            </Text>
          </Group>
          {!shown.length ? (
            <Alert variant="light" color="gray">
              No field photos in this report’s period{where}. <Anchor component="button" type="button" onClick={() => setScope('all')}>See all the project’s photos</Anchor>.
            </Alert>
          ) : (
            <ScrollArea.Autosize mah="58vh" type="auto" offsetScrollbars>
              <Stack gap="md">
                {days.map((d) => {
                  const free = d.photos.filter((p) => !added.has(p.path));
                  const allChosen = free.length > 0 && free.every((p) => chosen.has(p.path));
                  return (
                    <div key={d.day}>
                      <Group justify="space-between" mb={4}>
                        <Text size="sm" fw={600}>
                          {formatDateLong(d.day)}
                        </Text>
                        {free.length > 1 && (
                          <Anchor
                            component="button"
                            type="button"
                            size="xs"
                            onClick={() =>
                              setChosen((cur) => {
                                const next = new Set(cur);
                                for (const p of free) {
                                  if (allChosen) next.delete(p.path);
                                  else next.add(p.path);
                                }
                                return next;
                              })
                            }
                          >
                            {allChosen ? 'Clear this day' : 'Choose this day’s'}
                          </Anchor>
                        )}
                      </Group>
                      <SimpleGrid cols={{ base: 2, xs: 3, sm: 4 }} spacing="xs">
                        {d.photos.map((p) => (
                          <PhotoTile key={p.path} photo={p} site={siteMap.get(p.siteId)} chosen={chosen.has(p.path)} added={added.has(p.path)} onToggle={() => toggle(p.path)} />
                        ))}
                      </SimpleGrid>
                    </div>
                  );
                })}
              </Stack>
            </ScrollArea.Autosize>
          )}
          <Group justify="space-between" wrap="wrap" gap="xs">
            <Text size="sm" c="dimmed">
              {chosen.size ? `${chosen.size} chosen` : 'Click photos to choose them.'}
            </Text>
            <Group gap="xs">
              <Button variant="default" onClick={() => setOpen(false)} disabled={busy}>
                Cancel
              </Button>
              <Button onClick={add} disabled={!chosen.size} loading={busy}>
                {chosen.size > 1 ? `Add ${chosen.size} photos` : 'Add the photo'}
              </Button>
            </Group>
          </Group>
        </Stack>
      </Modal>
    </>
  );
}
