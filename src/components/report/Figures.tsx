import { useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { ActionIcon, Autocomplete, Group, Loader, SegmentedControl, Select, Stack, Switch, Text, TextInput, UnstyledButton } from '@mantine/core';
import { DndContext, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core';
import { SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { notifications } from '@mantine/notifications';
import { IconGripVertical, IconPhotoPlus, IconTrash } from '@tabler/icons-react';
import type { FigureImage, FiguresBlock } from '../../db/types';
import { captionFromFileName, readFigureFile } from '../../lib/image';
import { uid } from '../../lib/ids';

/** A name to refer to something in text with {{fig:name}}: lower case, no spaces. */
export const refName = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9.-]+/g, '-')
    .replace(/^-+/, '')
    .slice(0, 40);

const isImage = (f: File) => /^image\//i.test(f.type) || /\.(png|jpe?g|gif|webp|bmp|heic|heif)$/i.test(f.name);

function ImageRow({ image, index, numbering, onChange, onRemove, disabled }: { image: FigureImage; index: number; numbering: FiguresBlock['numbering'] | undefined; onChange: (im: FigureImage) => void; onRemove: () => void; disabled?: boolean }) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id: image.id, disabled });
  const style: CSSProperties = { transform: CSS.Transform.toString(transform), transition, position: 'relative', zIndex: isDragging ? 5 : undefined, background: 'var(--mantine-color-body)' };
  return (
    <div ref={setNodeRef} style={style}>
      <Group gap={8} wrap="nowrap" align="flex-start" py={4}>
        {!disabled && (
          <ActionIcon ref={setActivatorNodeRef} {...attributes} {...listeners} variant="subtle" color="gray" size="sm" mt={14} aria-label={`Drag image ${index + 1}`} style={{ cursor: 'grab', touchAction: 'none' }}>
            <IconGripVertical size={15} />
          </ActionIcon>
        )}
        <img src={image.src} alt={image.caption || `Image ${index + 1}`} style={{ width: 72, height: 54, objectFit: 'contain', background: 'var(--mantine-color-gray-1)', borderRadius: 4, flexShrink: 0 }} />
        <Stack gap={4} style={{ flex: 1, minWidth: 0 }}>
          <TextInput
            size="xs"
            aria-label={`Caption for image ${index + 1}`}
            placeholder="Caption"
            leftSection={numbering === 'group' ? <Text size="xs">({String.fromCharCode(97 + (index % 26))})</Text> : undefined}
            value={image.caption}
            onChange={(e) => onChange({ ...image, caption: e.currentTarget.value })}
          />
          <TextInput
            size="xs"
            aria-label={`Name to refer to image ${index + 1}`}
            placeholder="Name to refer to it (optional)"
            inputWrapperOrder={['label', 'input', 'description', 'error']}
            description={image.ref ? `{{fig:${image.ref}}} in text gives its number` : undefined}
            value={image.ref ?? ''}
            onChange={(e) => onChange({ ...image, ref: refName(e.currentTarget.value) || undefined })}
          />
        </Stack>
        {!disabled && (
          <ActionIcon variant="subtle" color="red" size="sm" mt={14} onClick={onRemove} aria-label={`Remove image ${index + 1}`}>
            <IconTrash size={14} />
          </ActionIcon>
        )}
      </Group>
    </div>
  );
}

/**
 * Images for a Figures section: drop them on the box, choose them or paste them; then caption, name and order
 * them (drag ⋮⋮). Images are scaled down as they are added so reports stay a sensible size.
 */
export function FigureImages({ images, onChange, numbering, disabled, hint, more }: { images: FigureImage[]; onChange: (images: FigureImage[]) => void; numbering?: FiguresBlock['numbering']; disabled?: boolean; hint?: string; /** Another way to add images, under the box (the project's field photos): given how to add them. */ more?: (add: (images: FigureImage[]) => void) => ReactNode }) {
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const [busy, setBusy] = useState(0);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));
  const latest = useRef(images);
  latest.current = images;
  const add = async (files: File[]) => {
    const list = files.filter(isImage);
    if (!list.length) {
      if (files.length) notifications.show({ color: 'orange', message: 'Those files aren’t images. Use PNG or JPEG pictures.' });
      return;
    }
    setBusy((n) => n + list.length);
    const added: FigureImage[] = [];
    for (const f of list) {
      try {
        if (f.size > 40 * 1024 * 1024) throw new Error(`“${f.name}” is over 40 MB.`);
        added.push({ id: uid('fig'), src: await readFigureFile(f), caption: captionFromFileName(f.name) });
      } catch (e) {
        notifications.show({ color: 'red', message: (e as Error).message });
      } finally {
        setBusy((n) => n - 1);
      }
    }
    if (added.length) onChange([...latest.current, ...added]);
  };
  const onDragEnd = (e: DragEndEvent) => {
    if (!e.over || e.active.id === e.over.id) return;
    const from = images.findIndex((im) => im.id === e.active.id);
    const to = images.findIndex((im) => im.id === e.over!.id);
    if (from >= 0 && to >= 0) onChange(arrayMove(images, from, to));
  };
  const dead = (el: Element) => disabled || !!el.closest('fieldset:disabled');
  return (
    <Stack gap={6}>
      {!disabled && (
        <UnstyledButton
          onClick={() => input.current?.click()}
          onDragOver={(e) => {
            if (dead(e.currentTarget)) return;
            e.preventDefault();
            setOver(true);
          }}
          onDragLeave={() => setOver(false)}
          onDrop={(e) => {
            if (dead(e.currentTarget)) return;
            e.preventDefault();
            setOver(false);
            void add(Array.from(e.dataTransfer.files));
          }}
          onPaste={(e) => {
            const files = Array.from(e.clipboardData.files);
            if (!files.length || dead(e.currentTarget)) return;
            e.preventDefault();
            void add(files);
          }}
          aria-label="Add images: drop them here, click to choose, or paste"
          style={{
            border: `1.5px dashed ${over ? 'var(--mantine-primary-color-6)' : 'var(--mantine-color-gray-4)'}`,
            borderRadius: 8,
            padding: '14px 12px',
            background: over ? 'var(--mantine-primary-color-light)' : 'var(--mantine-color-default-hover)',
            textAlign: 'center',
          }}
        >
          <Group gap={8} justify="center" wrap="nowrap">
            {busy ? <Loader size="xs" /> : <IconPhotoPlus size={20} color="var(--mantine-primary-color-7)" />}
            <div>
              <Text size="sm" fw={500}>
                {busy ? `Adding ${busy} image${busy === 1 ? '' : 's'}…` : 'Drop images here, click to choose, or paste'}
              </Text>
              <Text size="xs" c="dimmed">
                {hint ?? 'PNG or JPEG – photos, site plans, graphs from Excel'}
              </Text>
            </div>
          </Group>
        </UnstyledButton>
      )}
      {!disabled && more?.((added) => onChange([...latest.current, ...added]))}
      <input
        ref={input}
        type="file"
        accept="image/png,image/jpeg,image/gif,image/webp,image/bmp"
        multiple
        hidden
        onChange={(e) => {
          void add(Array.from(e.currentTarget.files ?? []));
          e.currentTarget.value = '';
        }}
      />
      {images.length > 0 && (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
          <SortableContext items={images.map((im) => im.id)} strategy={verticalListSortingStrategy}>
            <Stack gap={0}>
              {images.map((im, i) => (
                <ImageRow
                  key={im.id}
                  image={im}
                  index={i}
                  numbering={numbering}
                  disabled={disabled}
                  onChange={(next) => onChange(images.map((x) => (x.id === im.id ? next : x)))}
                  onRemove={() => onChange(images.filter((x) => x.id !== im.id))}
                />
              ))}
            </Stack>
          </SortableContext>
        </DndContext>
      )}
    </Stack>
  );
}

const HEIGHTS = [
  { value: '0', label: 'Fit the width' },
  { value: '45', label: 'Small – 45 mm' },
  { value: '65', label: 'Medium – 65 mm' },
  { value: '90', label: 'Large – 90 mm' },
];

/** How a Figures section lays out its images: per row, height, numbers and what they're called. */
export function FiguresLayout({ block, onChange }: { block: FiguresBlock; onChange: (b: FiguresBlock) => void }) {
  const set = (patch: Partial<FiguresBlock>) => onChange({ ...block, ...patch });
  const height = String(block.heightMm || 0);
  return (
    <Stack gap={8}>
      <Group gap="md" align="flex-end" wrap="wrap">
        <div>
          <Text size="sm" fw={500} mb={4}>
            Images per row
          </Text>
          <SegmentedControl size="xs" value={String(block.perRow)} onChange={(v) => set({ perRow: Number(v) as FiguresBlock['perRow'] })} data={['1', '2', '3', '4']} />
        </div>
        <Select
          size="xs"
          label="Size"
          w={160}
          allowDeselect={false}
          value={height}
          onChange={(v) => v && set({ heightMm: Number(v) })}
          data={HEIGHTS.some((h) => h.value === height) ? HEIGHTS : [...HEIGHTS, { value: height, label: `${height} mm high` }]}
        />
        <Autocomplete size="xs" label="Called" w={120} value={block.label} onChange={(v) => set({ label: v })} data={['Figure', 'Photo', 'Plate', 'Map', 'Drawing']} />
      </Group>
      <Select
        size="xs"
        label="Numbers"
        allowDeselect={false}
        value={block.numbering}
        onChange={(v) => v && set({ numbering: v as FiguresBlock['numbering'] })}
        data={[
          { value: 'each', label: `Each image numbered – ${block.label || 'Figure'} 1, ${block.label || 'Figure'} 2 …` },
          { value: 'group', label: `One number for them all – ${block.label || 'Figure'} 1 (a), (b) …` },
          { value: 'none', label: 'No numbers – captions only' },
        ]}
        maw={340}
      />
      {block.numbering === 'group' && <TextInput size="xs" label="Caption for the group" placeholder="e.g. Site photos, 30 September 2026" value={block.caption ?? ''} onChange={(e) => set({ caption: e.currentTarget.value })} />}
      <Switch size="xs" label="Thin border around each image" checked={!!block.border} onChange={(e) => set({ border: e.currentTarget.checked })} />
    </Stack>
  );
}
