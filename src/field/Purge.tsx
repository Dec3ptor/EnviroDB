// Purging a bore, on the phone at the bore: how much water stands in the casing and how much to take out, a log of
// the meter's readings as it's purged, and whether they've settled – then the last readings become the sample's.

import { useMemo, useState } from 'react';
import { ActionIcon, Alert, Badge, Button, Card, Collapse, Group, Modal, NumberInput, Progress, Stack, Table, Text, TextInput, UnstyledButton } from '@mantine/core';
import { IconCheck, IconChevronRight, IconDroplet, IconPlus, IconTrash } from '@tabler/icons-react';
import type { FieldMeasure, FieldSheet, FieldSite, FieldVisit } from './model';
import { DEFAULT_PURGE_VOLUMES, STABLE_RULES, litresPerMetre, purgeProgress, ruleText, stability, usualRules, withTolerances, type PurgeLog, type PurgeReading, type StableRule } from '../lib/purge';

const RULES_KEY = 'envirodb.field.purgeRules';
const DIAMETERS = [25, 32, 50, 80, 100, 150];
const n1 = (v: number) => (Math.round(v * 10) / 10).toString();
const n2 = (v: number) => (Math.round(v * 100) / 100).toString();
const nowTime = () => {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

/** This phone's own tolerances, by parameter (the usual ones where none is kept). */
function loadTolerances(): Record<string, number> {
  try {
    const v = JSON.parse(localStorage.getItem(RULES_KEY) ?? '{}') as unknown;
    return v && typeof v === 'object' ? (v as Record<string, number>) : {};
  } catch {
    return {};
  }
}

/** Whether a bore's purge helper belongs at a site: a bore with its details, a groundwater point, or one whose water level is taken. */
export const isBoreSite = (site: FieldSite, sheet: FieldSheet): boolean =>
  !!site.bore || site.type === 'Groundwater' || site.preset?.['bore-depth'] !== undefined || (sheet.measures.some((m) => m.id === 'swl') && (!site.measures || site.measures.includes('swl')));

export function PurgeHelper({ site, sheet, visit, onChange }: { site: FieldSite; sheet: FieldSheet; visit: FieldVisit; onChange: (patch: Partial<FieldVisit>) => void }) {
  const [open, setOpen] = useState(!!visit.purge?.readings.length);
  const [adding, setAdding] = useState(false);
  const [criteria, setCriteria] = useState(false);
  const [own, setOwn] = useState<Record<string, number>>(loadTolerances);
  const rules = useMemo(() => withTolerances(own), [own]);
  // what the volumes are worked out from: typed here, else today's readings, else the bore's details
  const log: PurgeLog = {
    readings: visit.purge?.readings ?? [],
    depth: visit.purge?.depth ?? visit.values['bore-depth'] ?? site.bore?.depth,
    swl: visit.purge?.swl ?? visit.values.swl,
    diameter: visit.purge?.diameter ?? site.bore?.diameter,
    volumes: visit.purge?.volumes,
  };
  const save = (patch: Partial<PurgeLog>) => {
    const next: PurgeLog = { ...(visit.purge ?? { readings: [] }), ...patch };
    for (const k of ['depth', 'swl', 'diameter', 'volumes'] as const) if (next[k] === undefined) delete next[k];
    // the criteria go with the log when they aren't the usual ones
    if (usualRules(rules)) delete next.rules;
    else next.rules = rules;
    onChange({ purge: next });
  };
  const p = purgeProgress(log);
  const s = stability(log.readings, rules);
  // the readings a meter gives as the bore's purged: pH, EC, temperature and DO – and any others the sheet asks for
  // here that have a criterion (redox, turbidity)
  const here = sheet.measures.filter((m) => !site.measures || site.measures.includes(m.id));
  const logged: FieldMeasure[] = useMemo(() => {
    const basic: Record<string, [string, string]> = { 'ph-field': ['pH', ''], 'ec-field': ['EC', 'µS/cm'], temp: ['Temperature', '°C'], do: ['DO', 'mg/L'] };
    return rules.flatMap((r) => {
      const onSheet = here.find((m) => m.id === r.id);
      if (onSheet) return [onSheet];
      return basic[r.id] ? [sheet.measures.find((m) => m.id === r.id) ?? { id: r.id, name: basic[r.id][0], unit: basic[r.id][1] }] : [];
    });
  }, [here, rules, sheet.measures]);
  const short = (m: FieldMeasure) => rules.find((r) => r.id === m.id)?.label ?? m.name.replace(/\s*\(field\)\s*/i, '');
  const last = log.readings[log.readings.length - 1];
  const volumes = log.volumes ?? DEFAULT_PURGE_VOLUMES;
  const useLast = () => {
    if (!last) return;
    const values = { ...visit.values };
    for (const [id, v] of Object.entries(last.values)) if (sheet.measures.some((m) => m.id === id)) values[id] = v;
    if (p.purged !== null) values['purge-vol'] = Math.round(p.purged * 10) / 10;
    onChange({ values });
  };
  const summary = p.casing !== null ? `${n1(p.casing)} L in the casing · ${n1(p.casing * volumes)} L to purge${p.purged !== null ? ` · ${n1(p.purged)} L out` : ''}` : log.readings.length ? `${log.readings.length} reading${log.readings.length === 1 ? '' : 's'}` : 'How much to take out, and when the readings settle';
  return (
    <Card withBorder padding="xs">
      <UnstyledButton onClick={() => setOpen(!open)} aria-expanded={open} style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%' }}>
        <IconChevronRight size={16} style={{ flexShrink: 0, transform: open ? 'rotate(90deg)' : undefined, transition: 'transform 150ms' }} />
        <IconDroplet size={16} style={{ flexShrink: 0 }} />
        <div style={{ minWidth: 0 }}>
          <Text size="sm" fw={600}>
            Purging the bore
          </Text>
          <Text size="xs" c="dimmed" truncate>
            {summary}
          </Text>
        </div>
        {s.enough && (
          <Badge ml="auto" color={s.stable ? 'teal' : 'orange'} variant="light" style={{ flexShrink: 0 }}>
            {s.stable ? 'Settled' : 'Not settled'}
          </Badge>
        )}
      </UnstyledButton>
      <Collapse in={open}>
        <Stack gap="sm" pt="sm">
          <Group grow gap="xs" align="flex-start">
            <NumberInput size="md" label="Bore depth · m" description="Below the casing’s top" value={log.depth ?? ''} inputMode="decimal" hideControls onChange={(x) => save({ depth: x === '' ? undefined : Number(x) })} />
            <NumberInput size="md" label="Depth to water · m" description={visit.values.swl !== undefined && visit.purge?.swl === undefined ? 'Today’s water level' : 'Before purging'} value={log.swl ?? ''} inputMode="decimal" hideControls onChange={(x) => save({ swl: x === '' ? undefined : Number(x) })} />
          </Group>
          <div>
            <NumberInput size="md" label="Casing’s inside diameter · mm" value={log.diameter ?? ''} inputMode="decimal" hideControls onChange={(x) => save({ diameter: x === '' ? undefined : Number(x) })} />
            <Group gap={6} mt={6}>
              {DIAMETERS.map((d) => (
                <Button key={d} size="compact-sm" variant={log.diameter === d ? 'filled' : 'default'} onClick={() => save({ diameter: d })}>
                  {d}
                </Button>
              ))}
            </Group>
          </div>
          {p.casing !== null ? (
            <Alert color="blue" variant="light" p="xs">
              <Text size="sm">
                <b>{n1(p.casing)} L</b> of water in the casing ({n2((log.depth ?? 0) - (log.swl ?? 0))} m at {n2(litresPerMetre(log.diameter ?? 0))} L a metre).
              </Text>
              <Group gap="xs" mt={4} align="center" wrap="nowrap">
                <Text size="sm" style={{ flexShrink: 0 }}>
                  To purge:
                </Text>
                {[1, 3, 5].map((k) => (
                  <Button key={k} size="compact-sm" variant={volumes === k ? 'filled' : 'default'} onClick={() => save({ volumes: k })}>
                    {k}×
                  </Button>
                ))}
                <Text size="sm" fw={600}>
                  {n1(p.casing * volumes)} L
                </Text>
              </Group>
              {p.purged !== null && (
                <>
                  <Progress value={Math.min(100, (p.purged / (p.casing * volumes)) * 100)} mt={8} color={p.purged >= p.casing * volumes ? 'teal' : 'blue'} aria-label="How much of the purge is done" />
                  <Text size="xs" mt={4}>
                    {n1(p.purged)} L out – {n1(p.volumesPurged ?? 0)} casing volume{Math.abs((p.volumesPurged ?? 0) - 1) < 0.05 ? '' : 's'}
                    {p.purged >= p.casing * volumes ? ' – enough' : `, ${n1(p.casing * volumes - p.purged)} L to go`}
                    {p.drawdown !== null && Math.abs(p.drawdown) >= 0.005 ? ` · the level has dropped ${n2(p.drawdown)} m` : ''}
                  </Text>
                </>
              )}
            </Alert>
          ) : (
            <Text size="xs" c="dimmed">
              {log.depth !== undefined && log.swl !== undefined && log.swl >= log.depth ? 'The water level is at or below the bottom of the bore – check the two depths.' : 'With the bore’s depth, the depth to water and the casing’s diameter, this works out how much water stands in it.'}
            </Text>
          )}
          {log.readings.length > 0 && (
            <Table.ScrollContainer minWidth={280}>
              <Table verticalSpacing={4} horizontalSpacing={6} fz="sm">
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>Time</Table.Th>
                    <Table.Th ta="right">L</Table.Th>
                    {logged.map((m) => (
                      <Table.Th key={m.id} ta="right">
                        {short(m)}
                      </Table.Th>
                    ))}
                    <Table.Th w={28} />
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {log.readings.map((r, i) => (
                    <Table.Tr key={i}>
                      <Table.Td>{r.time}</Table.Td>
                      <Table.Td ta="right">{r.litres ?? ''}</Table.Td>
                      {logged.map((m) => (
                        <Table.Td key={m.id} ta="right">
                          {r.values[m.id] ?? ''}
                        </Table.Td>
                      ))}
                      <Table.Td>
                        <ActionIcon size="sm" variant="subtle" color="gray" aria-label={`Take off the reading of ${r.time}`} onClick={() => save({ readings: log.readings.filter((_, j) => j !== i) })}>
                          <IconTrash size={14} />
                        </ActionIcon>
                      </Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            </Table.ScrollContainer>
          )}
          {s.enough ? (
            <Alert color={s.stable ? 'teal' : 'orange'} variant="light" p="xs" title={s.stable ? 'Settled: the last three readings agree' : 'Not settled yet'}>
              {s.checks.map((c) => (
                <Text size="xs" key={c.id}>
                  {c.ok ? '✓' : '✗'} {c.label}: {c.values.join(', ')} – {n2(c.spread)} apart ({ruleText(rules.find((r) => r.id === c.id)!)})
                </Text>
              ))}
            </Alert>
          ) : log.readings.length > 0 ? (
            <Text size="xs" c="dimmed">
              Three readings say whether they’ve settled – {3 - Math.min(2, log.readings.length)} more.
            </Text>
          ) : null}
          <Group gap="xs" grow>
            <Button size="md" leftSection={<IconPlus size={16} />} onClick={() => setAdding(true)}>
              Log a reading
            </Button>
            {last && (
              <Button size="md" variant="light" color="teal" leftSection={<IconCheck size={16} />} onClick={useLast}>
                Use the last
              </Button>
            )}
          </Group>
          {last && (
            <Text size="xs" c="dimmed">
              Use the last puts the last reading in as the sample’s readings above (those the sheet asks for), with the litres purged.
            </Text>
          )}
          <Text size="xs" c="dimmed">
            Settled means each of the last three readings {rules.filter((r) => logged.some((m) => m.id === r.id)).map((r) => `${r.label} ${ruleText(r)}`).join(', ')} of each other.{' '}
            <UnstyledButton onClick={() => setCriteria(true)} style={{ textDecoration: 'underline', fontSize: 'inherit', color: 'inherit' }}>
              Change the criteria
            </UnstyledButton>{' '}
            to your sampling plan’s. The log goes to the computer with the sample.
          </Text>
        </Stack>
      </Collapse>
      {adding && <ReadingModal measures={logged} short={short} last={last} onClose={() => setAdding(false)} onAdd={(r) => (save({ readings: [...log.readings, r] }), setAdding(false))} />}
      {criteria && (
        <CriteriaModal
          rules={rules}
          onClose={() => setCriteria(false)}
          onSave={(next) => {
            setOwn(next);
            try {
              if (Object.keys(next).length) localStorage.setItem(RULES_KEY, JSON.stringify(next));
              else localStorage.removeItem(RULES_KEY);
            } catch {
              /* kept for this visit only */
            }
            setCriteria(false);
          }}
        />
      )}
    </Card>
  );
}

/** A reading as the bore is purged: the time, the litres out so far, the meter's readings. */
function ReadingModal({ measures, short, last, onClose, onAdd }: { measures: FieldMeasure[]; short: (m: FieldMeasure) => string; last?: PurgeReading; onClose: () => void; onAdd: (r: PurgeReading) => void }) {
  const [time, setTime] = useState(nowTime());
  const [litres, setLitres] = useState<number | ''>('');
  const [level, setLevel] = useState<number | ''>('');
  const [values, setValues] = useState<Record<string, number>>({});
  const any = litres !== '' || level !== '' || Object.keys(values).length > 0;
  return (
    <Modal opened onClose={onClose} title="A reading while purging" size="md">
      <Stack gap="sm">
        <Group grow gap="xs" align="flex-end">
          <TextInput size="md" type="time" label="Time" value={time} onChange={(e) => setTime(e.currentTarget.value)} />
          <NumberInput size="md" label="Litres out so far" description={last?.litres !== undefined ? `Last ${last.litres}` : undefined} value={litres} inputMode="decimal" hideControls onChange={(x) => setLitres(x === '' ? '' : Number(x))} />
        </Group>
        {measures.map((m) => (
          <NumberInput
            key={m.id}
            size="md"
            label={`${short(m)}${m.unit ? ` · ${m.unit}` : ''}`}
            description={last?.values[m.id] !== undefined ? `Last ${last.values[m.id]}` : undefined}
            value={values[m.id] ?? ''}
            inputMode="decimal"
            decimalScale={6}
            hideControls
            onChange={(x) => {
              const next = { ...values };
              if (x === '' || Number.isNaN(Number(x))) delete next[m.id];
              else next[m.id] = Number(x);
              setValues(next);
            }}
          />
        ))}
        <NumberInput size="md" label="Depth to water now · m" description="Optional – to watch the drawdown" value={level} inputMode="decimal" hideControls onChange={(x) => setLevel(x === '' ? '' : Number(x))} />
        <Group justify="flex-end" gap="xs">
          <Button variant="default" size="md" onClick={onClose}>
            Cancel
          </Button>
          <Button size="md" disabled={!any} onClick={() => onAdd({ time, ...(litres !== '' ? { litres } : {}), ...(level !== '' ? { level } : {}), values })}>
            Log it
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}

/** How close the last three readings are to be: the usual criteria, changed to a sampling plan's on this phone. */
function CriteriaModal({ rules, onClose, onSave }: { rules: StableRule[]; onClose: () => void; onSave: (own: Record<string, number>) => void }) {
  const [tol, setTol] = useState<Record<string, number | ''>>(Object.fromEntries(rules.map((r) => [r.id, r.tol])));
  const own = () => Object.fromEntries(STABLE_RULES.flatMap((r) => (typeof tol[r.id] === 'number' && tol[r.id] !== r.tol && (tol[r.id] as number) > 0 ? [[r.id, tol[r.id] as number]] : [])));
  return (
    <Modal opened onClose={onClose} title="When the readings have settled" size="md">
      <Stack gap="sm">
        <Text size="sm" c="dimmed">
          Each of the last three readings within this much of each other. These are the usual low-flow criteria – set them to your sampling plan’s; they’re kept on this phone.
        </Text>
        {STABLE_RULES.map((r) => (
          <NumberInput key={r.id} size="md" label={`${r.label} – within`} rightSection={<Text size="xs" c="dimmed" pr={8}>{r.kind === 'pct' ? '%' : (r.unit ?? '')}</Text>} rightSectionWidth={54} value={tol[r.id] ?? ''} min={0} inputMode="decimal" hideControls onChange={(x) => setTol({ ...tol, [r.id]: x === '' ? '' : Number(x) })} />
        ))}
        <Group justify="space-between" gap="xs">
          <Button variant="subtle" size="md" onClick={() => onSave({})}>
            Back to the usual
          </Button>
          <Button size="md" onClick={() => onSave(own())}>
            Save
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
