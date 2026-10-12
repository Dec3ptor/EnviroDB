import { useMemo, useState, type CSSProperties } from 'react';
import { ActionIcon, Badge, Button, Card, Group, Menu, Stack, Text } from '@mantine/core';
import { DndContext, KeyboardSensor, MeasuringStrategy, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core';
import { SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { IconArrowDown, IconArrowUp, IconCopy, IconDots, IconPageBreak, IconGripVertical, IconLayoutRows, IconPlus, IconTrash } from '@tabler/icons-react';
import type { ReportBlock, ReportBlockType } from '../../db/types';
import { BLOCK_LABELS, BlockForm, blockSummary, newBlock } from './blocks';
import { uid } from '../../lib/ids';
import { insertAt, moveSection, sectionRange, setPages, stepSection, type Orientation } from './sections';
import { pageOrientations } from '../../reports/build';

function startsNewPage(blocks: ReportBlock[], i: number): boolean {
  const prev = blocks[i - 1];
  return i === 0 || prev.type === 'pageBreak' || (prev.type === 'title' && prev.pageBreakAfter);
}

interface RowProps {
  block: ReportBlock;
  index: number;
  blocks: ReportBlock[];
  orient: Orientation;
  base: Orientation;
  open: boolean;
  readOnly?: boolean;
  /** While this heading is dragged: how many rows of its section move with it. */
  carrying?: number;
  /** Indent: a heading by its level, anything else under the heading it belongs to. */
  depth: number;
  onToggle: () => void;
  onBlocks: (b: ReportBlock[]) => void;
}

function Row({ block, index, blocks, orient, base, open, readOnly, carrying, depth, onToggle, onBlocks }: RowProps) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id: block.id, disabled: readOnly });
  const style: CSSProperties = { transform: CSS.Transform.toString(transform), transition, position: 'relative', zIndex: isDragging ? 5 : undefined, opacity: isDragging ? 0.92 : 1 };
  const isBreak = block.type === 'pageBreak';
  const other: Orientation = orient === 'landscape' ? 'portrait' : 'landscape';
  const around = block.pages ? pageOrientations(setPages(blocks, index, undefined), base)[index] : orient; // without its own setting
  const isSection = block.type === 'heading';
  const name = block.type === 'heading' ? `heading “${block.text}”` : BLOCK_LABELS[block.type].label;
  const [a, z] = sectionRange(blocks, index);
  const inSection = z - a - 1; // blocks under a heading
  // a heading moves with its section; other blocks move one place
  const moved = (d: -1 | 1) => stepSection(blocks, index, d);
  const up = moved(-1);
  const down = moved(1);
  const copy = () => blocks.slice(a, z).map((b) => ({ ...structuredClone(b), id: uid('b') }));
  return (
    <div ref={setNodeRef} style={{ ...style, marginLeft: open || isDragging ? 0 : depth * 14 }}>
      <Card
        padding={isBreak || isSection ? 6 : 'xs'}
        py={isBreak || isSection ? 6 : 7}
        withBorder
        style={{
          borderColor: open ? 'var(--mantine-color-teal-5)' : undefined,
          borderStyle: isBreak ? 'dashed' : undefined,
          background: isBreak ? 'transparent' : isSection ? 'var(--mantine-color-default-hover)' : undefined,
          boxShadow: isDragging ? 'var(--mantine-shadow-md)' : undefined,
        }}
      >
        <Group justify="space-between" wrap="nowrap" gap={6}>
          {!readOnly && (
            <ActionIcon ref={setActivatorNodeRef} {...attributes} {...listeners} variant="subtle" color="gray" size="sm" aria-label={`Drag ${name}`} style={{ cursor: 'grab', touchAction: 'none' }}>
              <IconGripVertical size={15} />
            </ActionIcon>
          )}
          <div style={{ minWidth: 0, flex: 1, cursor: 'pointer' }} onClick={onToggle}>
            <Group gap={6} wrap="nowrap">
              {isBreak && <IconPageBreak size={15} color="var(--mantine-color-dimmed)" />}
              <Text size="sm" fw={isSection ? 700 : 600} c={isSection ? 'teal.8' : undefined} truncate>
                {block.type === 'heading' ? block.text : BLOCK_LABELS[block.type].label}
              </Text>
              {block.type === 'heading' && block.level > 1 && (
                <Text size="xs" c="dimmed" style={{ flexShrink: 0 }}>
                  H{block.level}
                </Text>
              )}
              {!!carrying && (
                <Badge size="xs" variant="filled" color="teal" style={{ flexShrink: 0 }}>
                  + {carrying} more
                </Badge>
              )}
              {isBreak && block.orientation && (
                <Badge size="xs" variant="light" color={block.orientation === 'landscape' ? 'grape' : 'blue'}>
                  {block.orientation}
                </Badge>
              )}
              {!isBreak && block.pages && (
                <Badge size="xs" variant="filled" color={block.pages === 'landscape' ? 'grape' : 'blue'} style={{ flexShrink: 0 }}>
                  {block.pages} pages
                </Badge>
              )}
              {!isBreak && !block.pages && orient !== base && (
                <Badge size="xs" variant="light" color={orient === 'landscape' ? 'grape' : 'blue'} style={{ flexShrink: 0 }}>
                  {orient}
                </Badge>
              )}
            </Group>
            {!isBreak && !isSection && (
              <Text size="xs" c="dimmed" truncate>
                {blockSummary(block)}
              </Text>
            )}
          </div>
          {!readOnly && (
            <Group gap={0} wrap="nowrap">
              <ActionIcon size="sm" variant="subtle" disabled={!up} onClick={() => up && onBlocks(up)} aria-label={`Move ${name} up`}>
                <IconArrowUp size={14} />
              </ActionIcon>
              <ActionIcon size="sm" variant="subtle" disabled={!down} onClick={() => down && onBlocks(down)} aria-label={`Move ${name} down`}>
                <IconArrowDown size={14} />
              </ActionIcon>
              <Menu position="bottom-end" withinPortal>
                <Menu.Target>
                  <ActionIcon size="sm" variant="subtle" aria-label={`More actions for ${name}`}>
                    <IconDots size={14} />
                  </ActionIcon>
                </Menu.Target>
                <Menu.Dropdown>
                  {!isBreak &&
                    (block.pages ? (
                      <Menu.Item leftSection={<IconLayoutRows size={14} />} onClick={() => onBlocks(setPages(blocks, index, undefined))}>
                        {isSection ? `Put this section back on ${around} pages` : `Put back on ${around} pages`}
                      </Menu.Item>
                    ) : (
                      <Menu.Item leftSection={<IconLayoutRows size={14} />} onClick={() => onBlocks(setPages(blocks, index, other))}>
                        {isSection ? `Put this section on ${other} pages` : `Put on ${other} pages`}
                      </Menu.Item>
                    ))}
                  {!isBreak && (
                    <Menu.Item leftSection={<IconPageBreak size={14} />} disabled={startsNewPage(blocks, index)} onClick={() => onBlocks([...blocks.slice(0, index), { id: uid('b'), type: 'pageBreak' }, ...blocks.slice(index)])}>
                      Start on a new page
                    </Menu.Item>
                  )}
                  <Menu.Item leftSection={<IconCopy size={14} />} onClick={() => onBlocks(insertAt(blocks, z, copy()))}>
                    {inSection ? 'Duplicate section' : 'Duplicate'}
                  </Menu.Item>
                  <Menu.Divider />
                  {inSection > 0 && (
                    <Menu.Item color="red" leftSection={<IconTrash size={14} />} onClick={() => onBlocks([...blocks.slice(0, a), ...blocks.slice(z)])}>
                      Remove section ({inSection + 1} items)
                    </Menu.Item>
                  )}
                  <Menu.Item color="red" leftSection={<IconTrash size={14} />} onClick={() => onBlocks(blocks.filter((x) => x.id !== block.id))}>
                    {inSection ? 'Remove heading only' : 'Remove'}
                  </Menu.Item>
                </Menu.Dropdown>
              </Menu>
            </Group>
          )}
        </Group>
        {open && (
          <fieldset disabled={readOnly} style={{ border: 0, padding: 0, margin: '8px 0 0', minWidth: 0 }}>
            <BlockForm block={block} onChange={(nb) => onBlocks(blocks.map((x) => (x.id === block.id ? nb : x)))} />
          </fieldset>
        )}
      </Card>
    </div>
  );
}

/**
 * The sections of a report template: drag (or use the arrows) to reorder – a heading takes its section with it –
 * tap to edit, and use the ⋯ menu to duplicate, remove, start a new page or put a section on landscape / portrait pages.
 */
export function SectionsEditor({ blocks, onChange, orientation, open, onOpen, readOnly }: { blocks: ReportBlock[]; onChange: (b: ReportBlock[]) => void; orientation: Orientation; open: string | null; onOpen: (id: string | null) => void; readOnly?: boolean }) {
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));
  const orient = useMemo(() => pageOrientations(blocks, orientation), [blocks, orientation]);
  const depths = useMemo(() => {
    let level = 0; // the heading level the blocks below belong to
    return blocks.map((b) => {
      if (b.type === 'title') return (level = 0);
      if (b.type === 'heading') {
        level = b.level;
        return b.level - 1;
      }
      return level;
    });
  }, [blocks]);
  const [dragging, setDragging] = useState<string | null>(null);
  const carried = useMemo(() => {
    const i = blocks.findIndex((b) => b.id === dragging);
    if (i < 0) return new Set<string>();
    const [a, z] = sectionRange(blocks, i);
    return new Set(blocks.slice(a + 1, z).map((b) => b.id));
  }, [blocks, dragging]);
  const onDragEnd = (e: DragEndEvent) => {
    setDragging(null);
    if (!e.over || e.active.id === e.over.id) return;
    const from = blocks.findIndex((b) => b.id === e.active.id);
    const to = blocks.findIndex((b) => b.id === e.over!.id);
    if (from >= 0 && to >= 0) onChange(moveSection(blocks, from, to));
  };
  const add = (type: ReportBlockType) => {
    const b = newBlock(type);
    const idx = open ? blocks.findIndex((x) => x.id === open) : -1;
    const list = [...blocks];
    list.splice(idx >= 0 ? idx + 1 : list.length, 0, b);
    onChange(list);
    onOpen(b.id);
  };
  return (
    <Stack gap={4}>
      {/* while a heading is dragged its section folds into it, so it lands with its content exactly where it is dropped */}
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        measuring={{ droppable: { strategy: MeasuringStrategy.Always } }}
        onDragStart={(e) => setDragging(String(e.active.id))}
        onDragCancel={() => setDragging(null)}
        onDragEnd={onDragEnd}
      >
        <SortableContext items={blocks.filter((b) => !carried.has(b.id)).map((b) => b.id)} strategy={verticalListSortingStrategy}>
          {blocks.map((b, i) =>
            carried.has(b.id) ? null : (
              <Row key={b.id} block={b} index={i} blocks={blocks} orient={orient[i]} base={orientation} open={open === b.id} readOnly={readOnly} carrying={b.id === dragging ? carried.size : 0} depth={depths[i]} onToggle={() => onOpen(open === b.id ? null : b.id)} onBlocks={onChange} />
            ),
          )}
        </SortableContext>
      </DndContext>
      {!readOnly && (
        <Menu position="bottom-start" width={320} withinPortal>
          <Menu.Target>
            <Button variant="light" size="xs" leftSection={<IconPlus size={14} />} style={{ alignSelf: 'flex-start' }}>
              Add section{open ? ' below the selected one' : ''}
            </Button>
          </Menu.Target>
          <Menu.Dropdown>
            {(Object.keys(BLOCK_LABELS) as ReportBlockType[]).map((k) => (
              <Menu.Item key={k} onClick={() => add(k)}>
                <Text size="sm" fw={500}>
                  {BLOCK_LABELS[k].label}
                </Text>
                <Text size="xs" c="dimmed">
                  {BLOCK_LABELS[k].help}
                </Text>
              </Menu.Item>
            ))}
          </Menu.Dropdown>
        </Menu>
      )}
    </Stack>
  );
}
