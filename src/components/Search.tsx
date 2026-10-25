// Ctrl K: search everything – projects, sites, parameters, limits, reports due, templates, guideline values and
// the app's pages – and go there. Arrow keys and Enter, or a click.

import { useEffect, useMemo, useRef, useState } from 'react';
import { ActionIcon, Badge, Group, Kbd, Modal, ScrollArea, Stack, Text, TextInput, Tooltip, UnstyledButton } from '@mantine/core';
import { IconSearch } from '@tabler/icons-react';
import { useNavigate } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/db';
import { useAllBundles } from '../hooks/useAllData';
import { KIND_TEXT, searchAll, type SearchHit, type SearchSource } from '../lib/search';

export function SearchButton({ onClick }: { onClick: () => void }) {
  return (
    <Tooltip label="Search everything (Ctrl K)" withArrow>
      <ActionIcon variant="default" size="lg" onClick={onClick} aria-label="Search everything">
        <IconSearch size={18} />
      </ActionIcon>
    </Tooltip>
  );
}

export function SearchModal({ opened, onClose }: { opened: boolean; onClose: () => void }) {
  const navigate = useNavigate();
  const { bundles, projects } = useAllBundles();
  const templates = useLiveQuery(() => db.templates.toArray(), []) ?? [];
  const guidelineSets = useLiveQuery(() => db.guidelineSets.toArray(), []) ?? [];
  const [q, setQ] = useState('');
  const [at, setAt] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (opened) {
      setQ('');
      setAt(0);
    }
  }, [opened]);
  const src = useMemo<SearchSource>(() => {
    const name = new Map(projects.map((p) => [p.id, p.name]));
    return {
      projects,
      sites: bundles.flatMap((b) => [...b.sites, ...(b.qc?.sites ?? [])].map((s) => ({ ...s, projectName: name.get(s.projectId) }))),
      params: bundles[0]?.params ?? [],
      rules: bundles.flatMap((b) => b.rules.map((r) => ({ ...r, projectName: name.get(r.projectId) }))),
      obligations: bundles.flatMap((b) => b.obligations.map((o) => ({ ...o, projectName: name.get(o.projectId) }))),
      templates,
      guidelineSets,
    };
  }, [bundles, projects, templates, guidelineSets]);
  const hits = useMemo(() => searchAll(q, src), [q, src]);
  const go = (h: SearchHit) => {
    onClose();
    navigate(h.to);
  };
  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-at="${at}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [at]);
  // the hits in their groups, in score order within each
  const groups = useMemo(() => {
    const out: Array<{ kind: SearchHit['kind']; hits: Array<SearchHit & { i: number }> }> = [];
    hits.forEach((h, i) => {
      const g = out.find((x) => x.kind === h.kind) ?? (out.push({ kind: h.kind, hits: [] }), out[out.length - 1]);
      g.hits.push({ ...h, i });
    });
    return out;
  }, [hits]);
  return (
    <Modal opened={opened} onClose={onClose} withCloseButton={false} size="lg" padding={0} radius="md" yOffset="10vh" aria-label="Search everything">
      <TextInput
        data-autofocus
        size="md"
        variant="unstyled"
        px="md"
        py={6}
        leftSection={<IconSearch size={18} />}
        placeholder="Search projects, sites, parameters, limits, reports due, pages…"
        aria-label="Search"
        value={q}
        onChange={(e) => {
          setQ(e.currentTarget.value);
          setAt(0);
        }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            setAt((a) => Math.min(hits.length - 1, a + 1));
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setAt((a) => Math.max(0, a - 1));
          } else if (e.key === 'Enter' && hits[at]) go(hits[at]);
        }}
        rightSection={
          <Kbd size="xs" style={{ marginRight: 8 }}>
            Esc
          </Kbd>
        }
        styles={{ input: { fontSize: 16 } }}
      />
      <ScrollArea.Autosize mah="60vh" ref={listRef} style={{ borderTop: '1px solid var(--mantine-color-default-border)' }}>
        {q.trim() && !hits.length && (
          <Text c="dimmed" size="sm" p="md">
            Nothing matches “{q.trim()}”. Try a site code, a project or client name, a parameter, or a page such as “calendar”.
          </Text>
        )}
        {!q.trim() && (
          <Text c="dimmed" size="sm" p="md">
            Type a few letters: a site code, a project, a parameter, a limit, a report that’s due, a page. ↑ ↓ to choose, Enter to go.
          </Text>
        )}
        <Stack gap={0} py={4}>
          {groups.map((g) => (
            <div key={g.kind}>
              <Text size="xs" c="dimmed" fw={600} tt="uppercase" px="md" pt={8} pb={2} style={{ letterSpacing: 0.4 }}>
                {KIND_TEXT[g.kind]}
              </Text>
              {g.hits.map((h) => (
                <UnstyledButton
                  key={`${h.kind}-${h.to}-${h.title}`}
                  data-at={h.i}
                  onClick={() => go(h)}
                  onMouseMove={() => setAt(h.i)}
                  px="md"
                  py={6}
                  w="100%"
                  style={{ background: h.i === at ? 'var(--mantine-primary-color-light)' : undefined, display: 'block' }}
                  aria-selected={h.i === at}
                  role="option"
                >
                  <Group justify="space-between" wrap="nowrap" gap="sm">
                    <div style={{ minWidth: 0 }}>
                      <Text size="sm" fw={500} truncate>
                        {h.title}
                      </Text>
                      {h.detail && (
                        <Text size="xs" c="dimmed" truncate>
                          {h.detail}
                        </Text>
                      )}
                    </div>
                    {h.i === at && (
                      <Badge variant="light" size="xs" style={{ flexShrink: 0 }}>
                        Enter ↵
                      </Badge>
                    )}
                  </Group>
                </UnstyledButton>
              ))}
            </div>
          ))}
        </Stack>
      </ScrollArea.Autosize>
    </Modal>
  );
}
